import Quote from "./Quote";

export default class TriangularArbitrage {

    constructor(public readonly coin: string,
                public readonly grossPercentageWin: number,
                public readonly buyQuote: Quote,
                public readonly sellQuote: Quote,
                public readonly convertQuote: Quote) {

    }

}
