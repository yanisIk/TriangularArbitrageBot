import Quote from "./Quote";

export default class TriangularArbitrage {

    public id: string;

    constructor(public readonly currency: string,
                public readonly pivotMarket: string,
                public readonly gapPercentage: number,
                public readonly buyQuote: Quote,
                public readonly sellQuote: Quote,
                public readonly convertQuote: Quote) {
        this.id = `${currency}-${pivotMarket}-${gapPercentage}-${Date.now()}`;
    }

}
