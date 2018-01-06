import { EventEmitter } from "events";
import Order from "../Models/Order";

export default interface IAccountManager {

    // key: currency, value: quantity available
    readonly balances: Map<string, number>;
    // key: marketName, value: order
    readonly openOrders: Map<string, Order>;

    getBalances(): Promise<Map<string, number>>;

    isSyncing(): boolean;

}
