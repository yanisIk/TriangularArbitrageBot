import * as Bluebird from "bluebird";
import { EventEmitter } from "events";
import { setInterval } from "timers";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import Order from "../Models/Order";
import * as CONFIG from "./../Config/CONFIG";
import IAccountManager from "./IAccountManager";

const bittrexClient = require("node-bittrex-api");
const bittrex = Bluebird.promisifyAll(bittrexClient);
bittrex.options({
    apikey : process.env.BITTREX_API_KEY,
    apisecret : process.env.BITTREX_API_SECRET,
    verbose : CONFIG.GLOBAL.VERBOSE_CLIENT,
    inverse_callback_arguments : true,
});

export default class BittrexAccountManager implements IAccountManager {

    // key: currency, value: quantity available
    public readonly balances: Map<string, number> = new Map();
    // key: marketName, value: order
    public readonly openOrders: Map<string, Order> = new Map();

    private readonly lastBalances: Map<string, number> = new Map();
    private watcherIntervalId: any;
    private _isSyncing: boolean = false;

    constructor() {

    }

    public async getBalances(): Promise<Map<string, number>> {
        return (await bittrex.getbalancesAsync()).result.filter((balance) => balance.Available > 0);
    }

    public isSyncing(): boolean {
        return this._isSyncing;
    }

    private async init() {
        await this.syncWallet();
    }

    private async syncWallet() {
        // SYNC WALLET
        const newBalances = (await bittrex.getbalancesAsync()).result.filter((balance) => balance.Available > 0);

        this._isSyncing = true;

        newBalances.forEach((balance) => {
            // store last balance
            this.lastBalances.set(balance.Currency, this.balances.get(balance.Currency));
            this.balances.set(balance.Currency, balance.Available);
        });

        this._isSyncing = false;
    }

    private checkIfWalletWasSync() {
        for (const newBalance of this.balances.entries()) {
            if (newBalance[1] && !this.lastBalances.get(newBalance[0])) {
                throw new Error(`Coin Desync: Didn't find ${newBalance[0]}`);
            }
            if (this.lastBalances.get(newBalance[0]) !== newBalance[1]) {
                throw new Error(`Balance Desync: ${newBalance[0]}
                                - Here: ${this.balances.get(newBalance[0])}, Real: ${newBalance[1]}`);
            }
        }
    }

    private startWalletWatcher() {
        if (this.watcherIntervalId) {
            return;
        }
        this.watcherIntervalId = setInterval(async () => {
            // sync first
            await this.syncWallet();
            this.checkIfWalletWasSync();
            // stop trading if desync ?
        }, CONFIG.BITTREX.WALLET_WATCH_INTERVAL);
    }

    private startWalletLogger() {
        if (this.watcherIntervalId) {
            return;
        }
        this.watcherIntervalId = setInterval(async () => {
            // sync first
            await this.syncWallet();
            this.checkIfWalletWasSync();
            // stop trading if desync ?
        }, CONFIG.BITTREX.WALLET_LOG_INTERVAL);
    }

    private add(coin, quantity) {
        if (quantity <= 0) {
            throw new Error(`Cannot add  ${quantity} ${coin}  (Balance: ${this.balances.get(coin)})`);
        }
        if (quantity > this.balances[coin]) {
            throw new Error(`Cannot remove more ${coin} (${quantity}) than balance (${this.balances.get(coin)})`);
        }
        const newQuantity = this.balances.get(coin) + quantity;
        this.balances.set(coin, newQuantity);
    }

    private remove(coin, quantity) {
        if (quantity <= 0) {
            throw new Error(`Cannot remove ${quantity} ${coin}  (Balance: ${this.balances.get(coin)})`);
        }
        if (quantity > this.balances[coin]) {
            throw new Error(`Cannot remove more ${coin} (${quantity}) than Balance (${this.balances.get(coin)})`);
        }
        const newQuantity = this.balances.get(coin) + quantity;
        this.balances.set(coin, newQuantity);
    }

    // private async saveState() {

    // }

}
