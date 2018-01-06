const CONFIG =  require("./../Config/CONFIG");
const Bluebird = require("bluebird");
const bittrex = Bluebird.promisifyAll(require("node-bittrex-api"));
bittrex.options({
  apikey : process.env.BITTREX_API_KEY,
  apisecret : process.env.BITTREX_API_SECRET,
  verbose : false,
  inverse_callback_arguments : true,
});

const async = require("async");
const EventEmitter = require("events");

let singleton = null;

module.exports = class BittrexExchangeService {

    constructor() {
        if (singleton) return singleton;
        singleton = this;

        this.openOrders = new Map();
    }

    async getMarketSummaries() {
        return (await bittrex.getmarketsummariesAsync()).result;
    }

    async getAllPairs() {
        return (await bittrex.getmarketsAsync()).result.map(m => m.MarketName);
    }

    async getTicker(marketName) {
        const ticker = await bittrex.gettickerAsync({market: marketName})
        if (!ticker.result) throw new Error(ticker.message);
        return ticker.result;
    }

    async getOrderBook(marketName) {
        const orderBook = await bittrex.getorderbookAsync({market: marketName, type: 'both'})
        if (!orderBook.result) throw new Error(orderBook.message);
        return orderBook.result;
    }
}