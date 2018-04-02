const Readable = require('stream').Readable;
const fs = require('fs');
const request = require('request-promise');
const _ = require('lodash');
const moment = require('moment');

async function getTicker(pair) {
    return (await request.get({url: `https://bittrex.com/api/v1.1/public/getticker?market=${pair}`, json: true}))
            .result;
}

async function getAllPairs() {
    return (await request.get({url: `https://bittrex.com/api/v1.1/public/getmarketsummaries`, json: true}))
            .result
            .map(r => r.MarketName);
}

const MAX_BASE_VOLUME = 50;
async function getAllLowVolumePairs() {
    return (await request.get({url: `https://bittrex.com/api/v1.1/public/getmarketsummaries`, json: true}))
            .result
            .filter(r => r.BaseVolume <= MAX_BASE_VOLUME)
            .sort((a, b) => b.BaseVolume - a.BaseVolume)
            .map(r => r.MarketName);
}

const MAX_WALL_DISTANCE_PERCENTAGE = 5;
const RATES_BIN_SIZE_PERCENTAGE = 0.05
async function detectWalls(pair) {

    const bidsBookPromise = request.get({url: `https://bittrex.com/api/v1.1/public/getorderbook?market=${pair}&type=buy`, json: true});
    const asksBookPromise = request.get({url: `https://bittrex.com/api/v1.1/public/getorderbook?market=${pair}&type=sell`, json: true});
    const book = {};
    [book.bids, book.asks] = (await Promise.all([bidsBookPromise, asksBookPromise])).map(b => b.result);
    
    // console.log(`\n------ PAIR: ${pair}   BID: ${book.bids[0].Rate}    ASK: ${book.asks[0].Rate}`)

    // - Get order book
    // - loop over bids until bid = -3% and over asks until ask = +3%
            
    let bidDiff = 0;
    let bidIndex = 1;
    let stop = false;
    while ((bidDiff > -MAX_WALL_DISTANCE_PERCENTAGE) && (stop != true)) {
        bidDiff = ((book.bids[bidIndex].Rate - book.bids[0].Rate) / book.bids[0].Rate) * 100;
        if (bidIndex === book.bids.length - 1) {
            stop = true;
        } else {
            bidIndex++;
        }
    }

    let askDiff = 0;
    let askIndex = 1;
    stop = false;
    while ((askDiff < MAX_WALL_DISTANCE_PERCENTAGE) && (stop != true)) {
        askDiff = ((book.asks[askIndex].Rate - book.asks[0].Rate) / book.asks[0].Rate) * 100;
        if (askIndex === book.asks.length - 1) {
            stop = true;
        } else {
            askIndex++;
        }
    }

    // console.log(`\n------- BID DIFF: ${bidDiff}%`);
    // console.log(`\n------- ASK DIFF: ${askDiff}%`);

    // - Find walls
    const bids = book.bids.slice(0, bidIndex+1);
    const asks = book.asks.slice(0, askIndex+1);

    // console.log(bids);
    // console.log(asks);

    // console.log(`\n------- BID INDEX: ${bidIndex} @ ${bids[bidIndex].Rate}`);
    // console.log(`\n------- ASK INDEX: ${askIndex} @ ${asks[askIndex].Rate}`);

    // Group by close values (for example [ [15000-15001-15002], [15010-15011-15012] ])
    // Called Group By Bins in data science
    const bidBins = [];
    let currentBin = [bids[0]]; 
    for (let i=1; i < bids.length; ++i) {
        let prevDiff = Math.abs( ( (bids[i].Rate - bids[i-1].Rate) / bids[i-1].Rate ) * 100 );
        if (prevDiff <= RATES_BIN_SIZE_PERCENTAGE) {
            currentBin.push(bids[i]);
        } else {
            bidBins.push(currentBin);
            currentBin = [bids[i]];
        }
    }
    

    const askBins = [];
    currentBin = [asks[0]]; 
    for (let i=1; i < asks.length; ++i) {
        let prevDiff = Math.abs( ( (asks[i].Rate - asks[i-1].Rate) / asks[i-1].Rate ) * 100 );
        if (prevDiff <= RATES_BIN_SIZE_PERCENTAGE) {
            currentBin.push(asks[i]);
        } else {
            askBins.push(currentBin);
            currentBin = [asks[i]];
        }
    }

    // console.log(`\n------- BID BINS INDEX: ${bidBins.length} @ [${bidBins[bidBins.length - 1][0].Rate}-${bidBins[bidBins.length - 1][bidBins[bidBins.length - 1].length - 1].Rate}]`);
    // // console.log(bidBins);
    // console.log(`\n------- ASK BINS INDEX: ${askBins.length} @ [${askBins[askBins.length - 1][0].Rate}-${askBins[askBins.length - 1][askBins[askBins.length - 1].length - 1].Rate}]`);
    // // console.log(askBins);

    // console.log(`\n------- BID BINS`);
    // for (bin of bidBins) {
    //     console.log(`[${bin[0].Rate}-${bin[bin.length - 1].Rate}]`)
    // }
    // console.log(`\n------- ASK BINS`);
    // for (ask of askBins) {
    //     console.log(`[${ask[0].Rate}-${ask[ask.length - 1].Rate}]`)
    // }
   

    // Flatten the bins (with rate = rate of first one)
    const groupedBidBins = bidBins.map((bidBin) => {
                                return {
                                    Rate: bidBin[0].Rate,
                                    Quantity: bidBin.map((bid) => bid.Quantity).reduce((totalQty, qty) => totalQty + qty)
                                }
                                });
    const groupedAskBins = askBins.map((askBin) => {
                                return {
                                    Rate: askBin[0].Rate,
                                    Quantity: askBin.map((ask) => ask.Quantity).reduce((totalQty, qty) => totalQty + qty)
                                }
                                });


    // console.log(`\n------- GROUPED BID BINS: ${groupedBidBins.length} @ ${groupedBidBins[groupedBidBins.length - 1].Rate}`);
    // console.log(groupedBidBins);
    // console.log(`\n------- GROUPED ASK BINS: ${groupedAskBins.length} @ ${groupedAskBins[groupedAskBins.length - 1].Rate}`);
    // console.log(groupedAskBins);

    // Sort by quantity
    let sortedGroupedBids = groupedBidBins.sort((a, b) => {
        return b.Quantity - a.Quantity;
    });
    let sortedGroupedAsks = groupedAskBins.sort((a, b) => {
        return b.Quantity - a.Quantity;
    });
    
    // console.log(`\n------- SORTED GROUPED BIDS:`);
    // console.log(sortedGroupedBids);
    // console.log(`\n------- SORTED GROUPED ASKS:`);
    // console.log(sortedGroupedAsks);   

    // - Calculate distance of walls from bid/ask in percentage
    sortedGroupedBids = sortedGroupedBids.map(b => {
        b.DistancePercentage = Math.abs( ( (b.Rate - bids[0].Rate) / bids[0].Rate ) * 100 );
        return b;
    });
    sortedGroupedAsks = sortedGroupedAsks.map(a => {
        a.DistancePercentage = Math.abs( ( (a.Rate - asks[0].Rate) / asks[0].Rate ) * 100 );
        return a;
    });

    // Get biggest 5 walls sorted by distance
    let bidWalls = sortedGroupedBids.slice(0, 5).sort((a, b) => {
        return a.DistancePercentage - b.DistancePercentage;
    });
    let askWalls = sortedGroupedAsks.slice(0, 5).sort((a, b) => {
        return a.DistancePercentage - b.DistancePercentage;
    });

    // Calculate quantity to reach each wall
    bidWalls = bidWalls.map(w => {
        w.QuantityDistance = bids.filter(bid => bid.Rate <= w.Rate).map(bid => bid.Quantity).reduce((a, b) => a + b, 0);
        return w;
    });

    askWalls = askWalls.map(w => {
        w.QuantityDistance = asks.filter(ask => ask.Rate <= w.Rate).map(ask => ask.Quantity).reduce((a, b) => a + b, 0);
        return w;
    }); 

    return {bidWalls: bidWalls, askWalls: askWalls};
   
}

async function analyseHistory(pair) {
    const tradeHistoryPromise = request.get({url: `https://bittrex.com/api/v1.1/public/getmarkethistory?market=${pair}`, json: true});
    const tradeHistory = (await tradeHistoryPromise).result;

    const buys = tradeHistory.filter(trade => trade.OrderType === 'BUY');
    const sells = tradeHistory.filter(trade => trade.OrderType === 'SELL');
    const buysVolume = buys.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty);
    const sellsVolume = sells.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty);
    const buySellRatio = buysVolume / sellsVolume;

    return {buys: buys, sells: sells, buysVolume: buysVolume, sellsVolume: sellsVolume, buySellRatio: buySellRatio};

    const maxBuyMinutes = moment.utc().diff(moment.utc(buys[buys.length -1].TimeStamp), 'minutes', true);
    const maxSellMinutes = moment.utc().diff(moment.utc(sells[sells.length -1].TimeStamp), 'minutes', true);
    const maxMinutes = maxBuyMinutes > maxSellMinutes ? maxSellMinutes : maxBuyMinutes;
    const numberOfWindows = 10;
    const range = maxMinutes / numberOfWindows;

    // Calculate for each Xmn range
    let i = 1;
    while (i < numberOfWindows) {
        let windowBuys = buys.filter(trade => moment.utc(trade.TimeStamp).diff(moment.utc(), 'minutes', true) >= (-range * i));
        let windowSells = sells.filter(trade => moment.utc(trade.TimeStamp).diff(moment.utc(), 'minutes', true) >= (-range * i));
        if ((windowBuys.length && windowSells.length)) {
            let windowBuysVolume = windowBuys.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty, 0);
            let windowSellsVolume = windowSells.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty, 0);
            let windowBuySellRatio = windowBuysVolume / windowSellsVolume;
            
            console.log(`\nFROM ${(range*i).toFixed(3)} minutes ago TO NOW:`)
            console.log(`----- ${windowBuys.length} BUY ORDERS FILLED (VOLUME: ${windowBuysVolume.toFixed(3)})`);
            console.log(`----- ${windowSells.length} SELL ORDERS FILLED (VOLUME: ${windowSellsVolume.toFixed(3)})`);
            console.log(`----- BUY/SELL RATIO = ${windowBuySellRatio.toFixed(3)}`);
        }
        ++i;
    }
    

}

async function analysePastSeconds(pair, seconds = 15, outStream) {
    const tradeHistoryPromise = request.get({url: `https://bittrex.com/api/v1.1/public/getmarkethistory?market=${pair}`, json: true});
    const tickerPromise = request.get({url: `https://bittrex.com/api/v1.1/public/getticker?market=${pair}`, json: true});

    let tradeHistory;
    let ticker;
    [tradeHistory, ticker] = (await Promise.all([tradeHistoryPromise, tickerPromise])).map(r => r.result);

    let buys = tradeHistory.filter(trade => trade.OrderType === 'BUY');
    let sells = tradeHistory.filter(trade => trade.OrderType === 'SELL');

    let windowBuys = buys.filter(trade => moment.utc(trade.TimeStamp).diff(moment.utc(), 'seconds', true) >= (-seconds));
    let windowSells = sells.filter(trade => moment.utc(trade.TimeStamp).diff(moment.utc(), 'seconds', true) >= (-seconds));
    
    let windowBuysVolume = windowBuys.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty, 0);
    let windowSellsVolume = windowSells.map(t => t.Quantity).reduce((totalQty, qty) => totalQty + qty, 0);
    let windowBuySellRatio = windowBuysVolume / windowSellsVolume;
    
    outStream.push(JSON.stringify({timestamp: Date.now(),
        bid: ticker.Bid, ask: ticker.Ask, last: ticker.Last,
        buyVolume: windowBuysVolume, sellVolume: windowSellsVolume,
        buySellVolumeRatio: windowBuySellRatio}));

    console.log(`\n\nFROM ${(seconds).toFixed(3)} seconds ago TO NOW:`)
    console.log(`----- ${windowBuys.length} BUY ORDERS FILLED (VOLUME: ${windowBuysVolume.toFixed(3)})`);
    console.log(`----- ${windowSells.length} SELL ORDERS FILLED (VOLUME: ${windowSellsVolume.toFixed(3)})`);
    console.log(`BUY VOLUME/s = ${(windowBuysVolume/seconds)}`);
    console.log(`SELL VOLUME/s = ${(windowSellsVolume/seconds)}`);
    console.log(`BUY/SELL RATIO = ${windowBuySellRatio.toFixed(3)}`);

    
    
}

async function saveToCsv(inStream, fileName) {
    const JSONToCSVStream = require('json2csv-stream');
    const json2csvStreamParser = new JSONToCSVStream();
    const fileWriteStream = fs.createWriteStream(fileName);

    inStream.pipe(json2csvStreamParser).pipe(fileWriteStream);

}

async function start() {
    try {
        const allLowVolumePairs = await getAllLowVolumePairs();
        allLowVolumePairs.slice(0, 2).forEach(async pair => {
            console.log(`Analysing ${pair}`);

            let ticker, walls, history;
            [ticker, walls, history] = await Promise.all([getTicker(pair), detectWalls(pair), analyseHistory(pair)]);
            
            // TODO: FIX detectWalls(pair) error: SyntaxError: Duplicate parameter name not allowed in this context

            console.log(`\n------- [${pair}] BID: ${ticker.Bid.toFixed(3)} - ASK: ${ticker.Ask.toFixed(3)}`)        
    
            console.log(`\nFROM ${moment.utc(history.buys[history.buys.length -1].TimeStamp).fromNow()}/${moment.utc(history.sells[history.sells.length -1].TimeStamp).fromNow()} (BUYS/SELLS) TO NOW:`)
            console.log(`----- ${history.buys.length} BUY ORDERS FILLED (VOLUME: ${history.buysVolume.toFixed(3)})`);
            console.log(`----- ${history.sells.length} SELL ORDERS FILLED (VOLUME: ${history.sellsVolume.toFixed(3)})`);
            console.log(`----- BUY/SELL RATIO = ${history.buySellRatio.toFixed(3)}`);
            
            console.log(`\n------- BID WALLS:`);
            walls.bidWalls.forEach(wall => {
                console.log(wall);
            });
        
            console.log(`\n------- ASK WALLS`);
            walls.askWalls.forEach(wall => {
                console.log(wall);
            });
            
            // console.log(`\n------- ${sortedGroupedBids[0].Rate} (-${bidWallDistance.toFixed(3)}%) <---- ${bids[0].Rate.toFixed(3)} | ${asks[0].Rate.toFixed(3)} ----> ${sortedGroupedAsks[0].Rate} (+${askWallDistance.toFixed(3)}%)`);
        
            // const dataStream = new Readable();
            // dataStream._read = function () {};
            // setInterval(async () => {
            //     await analysePastSeconds(pair, 90, dataStream);
            // }, 5000);
            // saveToCsv(dataStream, `${pair}_orders_data_history.csv`);
        
        });
    } catch (err) {
        console.error(err);
    }
}

start();

process.on('unhandledRejection', function(reason, p){
    console.log("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
    // application specific logging here
});

