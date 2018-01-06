import Quote from "./Quote";
import Order from "./Order";

export default class TriangularArbitrage {

    public id: string;
    public triangle: string;
    public buyOrder: Order;
    public sellOrder: Order;
    public convertOrder: Order;
    public status: TriangularArbitrageStatus = TriangularArbitrageStatus.IDLE;

    constructor(public readonly currency: string,
                public readonly pivotMarket: string,
                public readonly gapPercentage: number,
                public readonly buyQuote: Quote,
                public readonly sellQuote: Quote,
                public readonly convertQuote: Quote) {
        this.triangle = `${currency}-${pivotMarket}`;
        this.id = `${this.triangle}-${gapPercentage}%-${Date.now()}`;
    }

    public open(buyOrder: Order, sellOrder: Order, convertOrder: Order): void {
        this.status = TriangularArbitrageStatus.OPEN;
        this.buyOrder = buyOrder;
        this.sellOrder = sellOrder;
        this.convertOrder = convertOrder;
    }

    public close(buyOrder: Order, sellOrder: Order, convertOrder: Order): void {
        this.status = TriangularArbitrageStatus.CLOSE;
        this.buyOrder = buyOrder;
        this.sellOrder = sellOrder;
        this.convertOrder = convertOrder;
    }

}

export enum TriangularArbitrageStatus {
    IDLE,
    OPEN,
    CLOSE
}