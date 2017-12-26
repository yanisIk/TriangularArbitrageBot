export default class Tick {

    constructor(public readonly marketName: string,
                public readonly bid: number,
                public readonly ask: number,
                public readonly last: number,
                public readonly timestamp?: number) {

    }

    public get spread(): number {
        return this.ask - this.bid;
    }

    public get spreadPercentage(): number {
        return ((this.spread) / this.ask) * 100;
    }

    public get baseCurrency(): string {
        return this.marketName.split("-")[0];
    }

    public get marketCurrency(): string {
        return this.marketName.split("-")[1];
    }
}
