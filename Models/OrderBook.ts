import { OrderCondition, OrderSide, OrderTimeEffect, OrderType } from "./Order";

type OrderBookOrder = {Quantity: number, Rate: number};

export default class OrderBook {

    constructor(public readonly marketName: string,
                public readonly bids: Array<OrderBookOrder>,
                public readonly asks: Array<OrderBookOrder>) {

    }

}
