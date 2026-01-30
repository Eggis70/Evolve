import { global } from './vars.js';
import { loc } from './locale.js';
import { clearElement, vBind, messageQueue, modRes } from './functions.js';

const SESSION_PREFIX = 'evolve-mp-session-';

function ensureMultiplayerState(){
    if (!global.civic.multiplayer){
        global.civic.multiplayer = {
            clientId: `mp-${Math.random().toString(36).slice(2, 10)}`,
            code: '',
            joinCode: '',
            connected: false,
            inSession: false,
            session: null,
            listenerAdded: false,
            refresh: null,
            trade: {
                giveRes: '',
                giveAmount: 0,
                receiveRes: '',
                receiveAmount: 0
            }
        };
    }
}

function normalizeCode(code){
    return (code || '').trim().toUpperCase();
}

function sessionKey(code){
    return `${SESSION_PREFIX}${normalizeCode(code)}`;
}

function loadSession(code){
    let key = sessionKey(code);
    let stored = localStorage.getItem(key);
    if (!stored){
        return null;
    }
    try {
        let session = JSON.parse(stored);
        if (!session || session.code !== normalizeCode(code)){
            return null;
        }
        session.offers = session.offers || [];
        return session;
    }
    catch (e){
        return null;
    }
}

function saveSession(code, session){
    localStorage.setItem(sessionKey(code), JSON.stringify(session));
}

function deleteSession(code){
    localStorage.removeItem(sessionKey(code));
}

function buildResourceList(){
    return Object.keys(global.resource)
        .filter((res) => global.resource[res].display && global.resource[res].max !== 0)
        .map((res) => ({
            key: res,
            label: global.resource[res].name
        }));
}

function resolvePartner(session, clientId){
    if (!session){
        return '';
    }
    if (session.host === clientId){
        return session.guest || '';
    }
    if (session.guest === clientId){
        return session.host || '';
    }
    return '';
}

function applyTradeOffer(offer, clientId){
    let give = offer.give;
    let receive = offer.receive;
    if (!give || !receive){
        return false;
    }
    if (offer.applied && offer.applied[clientId]){
        return false;
    }
    let giveRes = give.res;
    let receiveRes = receive.res;
    let giveAmount = Number(give.amount) || 0;
    let receiveAmount = Number(receive.amount) || 0;
    if (!global.resource[giveRes] || !global.resource[receiveRes]){
        return false;
    }
    let success = true;
    if (offer.from === clientId){
        if (global.resource[giveRes].amount < giveAmount){
            return false;
        }
        success = modRes(giveRes, -giveAmount, true) && modRes(receiveRes, receiveAmount, true);
    }
    else if (offer.to === clientId){
        if (global.resource[receiveRes].amount < receiveAmount){
            return false;
        }
        success = modRes(receiveRes, -receiveAmount, true) && modRes(giveRes, giveAmount, true);
    }
    if (!offer.applied){
        offer.applied = {};
    }
    offer.applied[clientId] = true;
    return success;
}

export function drawCities(){
    ensureMultiplayerState();
    let container = $('#cities');
    if (container.length === 0){
        return;
    }
    clearElement(container);

    let multiplayer = global.civic.multiplayer;
    let resources = buildResourceList();
    if (!multiplayer.trade.giveRes && resources.length){
        multiplayer.trade.giveRes = resources[0].key;
    }
    if (!multiplayer.trade.receiveRes && resources.length){
        multiplayer.trade.receiveRes = resources[0].key;
    }

    container.append(`
        <div id="citiesPanel" class="citiesPanel">
            <div class="header"><h2 class="has-text-warning">${loc('civics_cities')}</h2></div>
            <div class="citiesSection">
                <p class="has-text-advanced">${loc('civics_cities_desc')}</p>
                <div class="citiesRow">
                    <span class="citiesLabel">${loc('civics_cities_code_label')}</span>
                    <b-input v-model="m.code" maxlength="10" :disabled="m.inSession"></b-input>
                    <button class="button" @click="generateCode">${loc('civics_cities_generate')}</button>
                </div>
                <div class="citiesRow">
                    <span class="citiesLabel">${loc('civics_cities_join_label')}</span>
                    <b-input v-model="m.joinCode" maxlength="10" :disabled="m.inSession"></b-input>
                    <button class="button" @click="connect">${loc('civics_cities_connect')}</button>
                    <button class="button" v-show="m.inSession" @click="disconnect">${loc('civics_cities_disconnect')}</button>
                </div>
                <div class="citiesStatus">{{ statusLabel() }}</div>
            </div>
            <div class="citiesSection">
                <h3 class="has-text-warning">${loc('civics_cities_trade')}</h3>
                <div class="tradeRow">
                    <span class="citiesLabel">${loc('civics_cities_give')}</span>
                    <select v-model="m.trade.giveRes">
                        <option v-for="res in resources" :key="res.key" :value="res.key">{{ res.label }}</option>
                    </select>
                    <input class="amount" type="number" min="0" v-model.number="m.trade.giveAmount">
                </div>
                <div class="tradeRow">
                    <span class="citiesLabel">${loc('civics_cities_receive')}</span>
                    <select v-model="m.trade.receiveRes">
                        <option v-for="res in resources" :key="res.key" :value="res.key">{{ res.label }}</option>
                    </select>
                    <input class="amount" type="number" min="0" v-model.number="m.trade.receiveAmount">
                </div>
                <div class="tradeRow">
                    <button class="button" :disabled="!m.connected" @click="sendOffer">${loc('civics_cities_send_offer')}</button>
                </div>
                <div class="offers">
                    <div class="offersColumn">
                        <h4 class="has-text-warning">${loc('civics_cities_incoming')}</h4>
                        <div v-if="incomingOffers().length === 0" class="has-text-advanced">${loc('civics_cities_none')}</div>
                        <div v-for="offer in incomingOffers()" :key="offer.id" class="offerRow">
                            <span>{{ offerLabel(offer) }}</span>
                            <button class="button" @click="acceptOffer(offer)">${loc('civics_cities_accept')}</button>
                            <button class="button" @click="rejectOffer(offer)">${loc('civics_cities_reject')}</button>
                        </div>
                    </div>
                    <div class="offersColumn">
                        <h4 class="has-text-warning">${loc('civics_cities_outgoing')}</h4>
                        <div v-if="outgoingOffers().length === 0" class="has-text-advanced">${loc('civics_cities_none')}</div>
                        <div v-for="offer in outgoingOffers()" :key="offer.id" class="offerRow">
                            <span>{{ offerLabel(offer) }}</span>
                            <span class="has-text-advanced">({{ offer.status }})</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    vBind({
        el: '#citiesPanel',
        data: {
            m: multiplayer,
            resources: resources
        },
        methods: {
            statusLabel(){
                if (this.m.connected){
                    let partner = resolvePartner(this.m.session, this.m.clientId);
                    return loc('civics_cities_status_connected',[partner || loc('civics_cities_partner')]);
                }
                if (this.m.inSession){
                    return loc('civics_cities_status_waiting');
                }
                return loc('civics_cities_status_disconnected');
            },
            syncSession(){
                if (!this.m.code){
                    this.m.session = null;
                    this.m.connected = false;
                    this.m.inSession = false;
                    return;
                }
                let session = loadSession(this.m.code);
                this.m.session = session;
                if (!session){
                    this.m.connected = false;
                    this.m.inSession = false;
                    return;
                }
                this.m.inSession = session.host === this.m.clientId || session.guest === this.m.clientId;
                this.m.connected = this.m.inSession && session.host && session.guest;
                if (session.offers && session.offers.length){
                    let updated = false;
                    session.offers.forEach((offer) => {
                        if (offer.status === 'accepted'){
                            let applied = applyTradeOffer(offer, this.m.clientId);
                            if (applied){
                                messageQueue(loc('civics_cities_trade_applied'), 'success', false);
                                updated = true;
                            }
                        }
                    });
                    if (updated){
                        saveSession(this.m.code, session);
                    }
                }
            },
            generateCode(){
                let code = normalizeCode(this.m.code);
                if (!code){
                    code = `${Math.rand(100000, 999999)}`;
                }
                let session = loadSession(code);
                if (session && session.host && session.guest){
                    messageQueue(loc('civics_cities_connection_full'), 'warning', false);
                    return;
                }
                if (!session){
                    session = {
                        code: code,
                        host: this.m.clientId,
                        guest: null,
                        offers: []
                    };
                }
                else {
                    session.host = this.m.clientId;
                    session.guest = session.guest === this.m.clientId ? null : session.guest;
                }
                this.m.code = code;
                this.m.joinCode = '';
                saveSession(code, session);
                this.syncSession();
                messageQueue(loc('civics_cities_connected_msg'), 'success', false);
            },
            connect(){
                let code = normalizeCode(this.m.joinCode);
                if (!code){
                    messageQueue(loc('civics_cities_invalid_code'), 'warning', false);
                    return;
                }
                let session = loadSession(code);
                if (!session){
                    messageQueue(loc('civics_cities_invalid_code'), 'warning', false);
                    return;
                }
                if (session.host && session.guest && session.host !== this.m.clientId && session.guest !== this.m.clientId){
                    messageQueue(loc('civics_cities_connection_full'), 'warning', false);
                    return;
                }
                if (!session.host){
                    session.host = this.m.clientId;
                }
                else if (!session.guest && session.host !== this.m.clientId){
                    session.guest = this.m.clientId;
                }
                this.m.code = code;
                saveSession(code, session);
                this.syncSession();
                messageQueue(loc('civics_cities_connected_msg'), 'success', false);
            },
            disconnect(){
                if (!this.m.code){
                    return;
                }
                let session = loadSession(this.m.code);
                if (session){
                    if (session.host === this.m.clientId){
                        if (session.guest){
                            session.host = null;
                            session.offers = session.offers || [];
                            saveSession(this.m.code, session);
                        }
                        else {
                            deleteSession(this.m.code);
                        }
                    }
                    else if (session.guest === this.m.clientId){
                        session.guest = null;
                        session.offers = session.offers || [];
                        saveSession(this.m.code, session);
                    }
                }
                this.m.code = '';
                this.m.joinCode = '';
                this.m.session = null;
                this.m.connected = false;
                this.m.inSession = false;
                messageQueue(loc('civics_cities_disconnected_msg'), 'warning', false);
            },
            sendOffer(){
                if (!this.m.connected || !this.m.session){
                    return;
                }
                let giveAmount = Number(this.m.trade.giveAmount) || 0;
                let receiveAmount = Number(this.m.trade.receiveAmount) || 0;
                if (!this.m.trade.giveRes || !this.m.trade.receiveRes || giveAmount <= 0 || receiveAmount <= 0){
                    messageQueue(loc('civics_cities_trade_failed'), 'warning', false);
                    return;
                }
                if (global.resource[this.m.trade.giveRes].amount < giveAmount){
                    messageQueue(loc('civics_cities_trade_failed'), 'warning', false);
                    return;
                }
                let partner = resolvePartner(this.m.session, this.m.clientId);
                if (!partner){
                    messageQueue(loc('civics_cities_trade_failed'), 'warning', false);
                    return;
                }
                let offer = {
                    id: `offer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    from: this.m.clientId,
                    to: partner,
                    give: { res: this.m.trade.giveRes, amount: giveAmount },
                    receive: { res: this.m.trade.receiveRes, amount: receiveAmount },
                    status: 'pending',
                    applied: {}
                };
                this.m.session.offers.push(offer);
                saveSession(this.m.code, this.m.session);
                messageQueue(loc('civics_cities_offer_sent'), 'success', false);
                this.syncSession();
            },
            incomingOffers(){
                if (!this.m.session || !this.m.session.offers){
                    return [];
                }
                return this.m.session.offers.filter((offer) => offer.to === this.m.clientId && offer.status === 'pending');
            },
            outgoingOffers(){
                if (!this.m.session || !this.m.session.offers){
                    return [];
                }
                return this.m.session.offers.filter((offer) => offer.from === this.m.clientId);
            },
            offerLabel(offer){
                let give = `${offer.give.amount} ${global.resource[offer.give.res].name}`;
                let receive = `${offer.receive.amount} ${global.resource[offer.receive.res].name}`;
                return loc('civics_cities_offer_label',[give, receive]);
            },
            acceptOffer(offer){
                if (!offer || offer.status !== 'pending'){
                    return;
                }
                if (global.resource[offer.receive.res].amount < offer.receive.amount){
                    messageQueue(loc('civics_cities_trade_failed'), 'warning', false);
                    return;
                }
                offer.status = 'accepted';
                saveSession(this.m.code, this.m.session);
                this.syncSession();
            },
            rejectOffer(offer){
                if (!offer || offer.status !== 'pending'){
                    return;
                }
                offer.status = 'rejected';
                saveSession(this.m.code, this.m.session);
                this.syncSession();
            }
        },
        created(){
            this.syncSession();
            this.m.refresh = () => this.syncSession();
            if (!this.m.listenerAdded){
                this.m.listenerAdded = true;
                window.addEventListener('storage', (event) => {
                    if (event.key && event.key.startsWith(SESSION_PREFIX) && global.civic.multiplayer.refresh){
                        global.civic.multiplayer.refresh();
                    }
                });
            }
        }
    });
}
