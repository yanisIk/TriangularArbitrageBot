/* ============================================================
 * node.bittrex.api
 * https://github.com/dparlevliet/node.bittrex.api
 *
 * ============================================================
 * Copyright 2014-, Adrian Soluch, David Parlevliet
 * Released under the MIT License
 * ============================================================ */

var NodeBittrexApi = function() {
    'use strict';
  
    var request = require('request'),
      assign = require('object-assign'),
      hmac_sha512 = require('./hmac-sha512.js'),
      jsonic = require('jsonic'),
      signalR = require('signalr-client'),
      wsclient,
      cloudscraper = require('cloudscraper');
  
    var default_request_options = {
      method: 'GET',
      agent: false,
      headers: {
        'User-Agent': 'Mozilla/4.0 (compatible; Node Bittrex API)',
        'Content-type': 'application/x-www-form-urlencoded'
      }
    };
  
    var opts = {
      baseUrl: 'https://bittrex.com/api/v1.1',
      baseUrlv2: 'https://bittrex.com/Api/v2.0',
      websockets_baseurl: 'wss://socket.bittrex.com/signalr',
      websockets_hubs: ['CoreHub'],
      apikey: 'APIKEY',
      apisecret: 'APISECRET',
      verbose: false,
      cleartext: false,
      inverse_callback_arguments: false,
      websockets: {
        autoReconnect: true,
      },
      requestTimeoutInSeconds: 5,
    };
  
    var lastNonce = 0;
    var nonceIncr = 0;
    var getNonce = function() {
      var now = new Date().getTime();
  
      if(now !== lastNonce)
        nonceIncr = -1;
  
        lastNonce = now;
        nonceIncr++;
  
        // add padding to nonce incr
        // @link https://stackoverflow.com/questions/6823592/numbers-in-the-form-of-001
        var padding =
          nonceIncr < 10 ? '000' :
            nonceIncr < 100 ? '00' :
              nonceIncr < 1000 ?  '0' : '';
        return now + padding + nonceIncr;
    };
  
    var extractOptions = function(options) {
      var o = Object.keys(options),
        i;
      for (i = 0; i < o.length; i++) {
        opts[o[i]] = options[o[i]];
      }
    };
  
    var apiCredentials = function(uri) {
      var options = {
        apikey: opts.apikey,
        nonce: getNonce()
      };
  
      return setRequestUriGetParams(uri, options);
    };
  
    var setRequestUriGetParams = function(uri, options) {
      var op;
      if (typeof(uri) === 'object') {
        op = uri;
        uri = op.uri;
      } else {
        op = assign({}, default_request_options);
      }
  
  
      var o = Object.keys(options),
        i;
      for (i = 0; i < o.length; i++) {
        uri = updateQueryStringParameter(uri, o[i], options[o[i]]);
      }
  
      op.headers.apisign = hmac_sha512.HmacSHA512(uri, opts.apisecret); // setting the HMAC hash `apisign` http header
      op.uri = uri;
      op.timeout = opts.requestTimeoutInSeconds * 1000;

      return op;
    };
  
    var updateQueryStringParameter = function(uri, key, value) {
      var re = new RegExp("([?&])" + key + "=.*?(&|$)", "i");
      var separator = uri.indexOf('?') !== -1 ? "&" : "?";
  
      if (uri.match(re)) {
        uri = uri.replace(re, '$1' + key + "=" + value + '$2');
      } else {
        uri = uri + separator + key + "=" + value;
      }
  
      return uri;
    };
  
    var sendRequestCallback = function(callback, op) {
      var start = Date.now();
  
      request(op, function(error, result, body) {
        ((opts.verbose) ? console.log("requested from " + op.uri + " in: %ds", (Date.now() - start) / 1000) : '');
        if (!body || !result || result.statusCode != 200) {
          var errorObj = {
            success: false,
            message: 'URL request error',
            error: error,
            result: result,
          };
          return ((opts.inverse_callback_arguments) ?
            callback(errorObj, null) :
            callback(null, errorObj));
        } else {
          try {
            result = JSON.parse(body);
          } catch (err) {}
          if (!result || !result.success) {
            // error returned by bittrex API - forward the result as an error
            return ((opts.inverse_callback_arguments) ?
              callback(result, null) :
              callback(null, result));
          }
          return ((opts.inverse_callback_arguments) ?
            callback(null, ((opts.cleartext) ? body : result)) :
            callback(((opts.cleartext) ? body : result), null));
        }
      });
    };
  
    var publicApiCall = function(url, callback, options) {
      var op = assign({}, default_request_options);
      if (!options) {
        op.uri = url;
      }
      sendRequestCallback(callback, (!options) ? op : setRequestUriGetParams(url, options));
    };
  
    var credentialApiCall = function(url, callback, options) {
      if (options) {
        options = setRequestUriGetParams(apiCredentials(url), options);
      }
      sendRequestCallback(callback, options);
    };
  
    var websocketGlobalTickers = false;
    var websocketGlobalTickerCallback;
    var websocketMarkets = [];
    var websocketMarketsCallback;
  
    var connectws = function(callback, force) {
      if (wsclient && !force && callback) {
        return callback(wsclient);
      }
      if (force) {
        try { wsclient.end(); } catch (e) {}
      }
      cloudscraper.get('https://bittrex.com/', function(error, response, body) {
        if (error) {
          console.error('Cloudscraper error occurred');
          console.error(error);
        } else {
          opts.headers = {
            cookie: (response.request.headers["cookie"] || ''),
            user_agent: (response.request.headers["User-Agent"] || '')
          };
          wsclient = new signalR.client(
            opts.websockets_baseurl,
            opts.websockets_hubs,
           undefined,
           true
          );
          if (opts.headers) {
            wsclient.headers['User-Agent'] = opts.headers.user_agent;
            wsclient.headers['cookie'] = opts.headers.cookie;
          }
          wsclient.start();
          wsclient.serviceHandlers = {
            bound: function() {
              ((opts.verbose) ? console.log('Websocket bound') : '');
              if (opts.websockets && typeof(opts.websockets.onConnect) === 'function') {
                opts.websockets.onConnect();
              }
            },
            connectFailed: function(error) {
              ((opts.verbose) ? console.log('Websocket connectFailed: ', error) : '');
            },
            disconnected: function() {
              ((opts.verbose) ? console.log('Websocket disconnected') : '');
              if (opts.websockets && typeof(opts.websockets.onDisconnect) === 'function') {
                opts.websockets.onDisconnect();
              }
  
              if (
                opts.websockets &&
                (
                  opts.websockets.autoReconnect === true ||
                  typeof(opts.websockets.autoReconnect) === 'undefined'
                )
              ) {
                ((opts.verbose) ? console.log('Websocket auto reconnecting.') : '');
                wsclient.start(); // ensure we try reconnect
              }
            },
            onerror: function(error) {
              ((opts.verbose) ? console.log('Websocket onerror: ', error) : '');
            },
            bindingError: function(error) {
              ((opts.verbose) ? console.log('Websocket bindingError: ', error) : '');
            },
            connectionLost: function(error) {
              ((opts.verbose) ? console.log('Connection Lost: ', error) : '');
            },
            reconnecting: function(retry) {
              ((opts.verbose) ? console.log('Websocket Retrying: ', retry) : '');
              // change to true to stop retrying
              return false;
            },
            connected: function() {
              if (websocketGlobalTickers) {
                wsclient.call('CoreHub', 'SubscribeToSummaryDeltas').done(function(err, result) {
                  if (err) {
                    return console.error(err);
                  }
  
                  if (result === true) {
                    ((opts.verbose) ? console.log('Subscribed to global tickers') : '');
                  }
                });
              }
  
              if (websocketMarkets.length > 0) {
                websocketMarkets.forEach(function(market) {
                  wsclient.call('CoreHub', 'SubscribeToExchangeDeltas', market).done(function(err, result) {
                    if (err) {
                      return console.error(err);
                    }
  
                    if (result === true) {
                      ((opts.verbose) ? console.log('Subscribed to ' + market) : '');
                    }
                  });
                });
              }
              ((opts.verbose) ? console.log('Websocket connected') : '');
            },
          };
          if (callback) {
            callback(wsclient);
          }
        }
      });
      return wsclient;
    };
  
    var setMessageReceivedWs = function() {
      wsclient.serviceHandlers.messageReceived = function(message) {
        try {
          var data = jsonic(message.utf8Data);
          if (data && data.M) {
            data.M.forEach(function(M) {
              if (websocketGlobalTickerCallback) {
                websocketGlobalTickerCallback(M, wsclient);
              }
              if (websocketMarketsCallback) {
                websocketMarketsCallback(M, wsclient);
              }
            });
          } else {
            // ((opts.verbose) ? console.log('Unhandled data', data) : '');
            if (websocketGlobalTickerCallback) {
              websocketGlobalTickerCallback({'unhandled_data' : data}, wsclient);
            }
            if (websocketMarketsCallback) {
              websocketMarketsCallback({'unhandled_data' : data}, wsclient);
            }
          }
        } catch (e) {
          ((opts.verbose) ? console.error(e) : '');
        }
        return false;
      };
    };
  
    return {
      options: function(options) {
        extractOptions(options);
      },
      websockets: {
        client: function(callback) {
          return connectws(callback);
        },
        listen: function(callback) {
          connectws(function() {
            websocketGlobalTickers = true;
            websocketGlobalTickerCallback = callback;
            setMessageReceivedWs();
          });
        },
        subscribe: function(markets, callback) {
          connectws(function() {
            websocketMarkets = markets;
            websocketMarketsCallback = callback;
            setMessageReceivedWs();
          });
        }
      },
      sendCustomRequest: function(request_string, callback, credentials) {
        var op;
  
        if (credentials === true) {
          op = apiCredentials(request_string);
        } else {
          op = assign({}, default_request_options, { uri: request_string });
        }
        sendRequestCallback(callback, op);
      },
      getmarkets: function(callback) {
        publicApiCall(opts.baseUrl + '/public/getmarkets', callback, null);
      },
      getcurrencies: function(callback) {
        publicApiCall(opts.baseUrl + '/public/getcurrencies', callback, null);
      },
      getticker: function(options, callback) {
        publicApiCall(opts.baseUrl + '/public/getticker', callback, options);
      },
      getmarketsummaries: function(callback) {
        publicApiCall(opts.baseUrl + '/public/getmarketsummaries', callback, null);
      },
      getmarketsummary: function(options, callback) {
        publicApiCall(opts.baseUrl + '/public/getmarketsummary', callback, options);
      },
      getorderbook: function(options, callback) {
        publicApiCall(opts.baseUrl + '/public/getorderbook', callback, options);
      },
      getmarkethistory: function(options, callback) {
        publicApiCall(opts.baseUrl + '/public/getmarkethistory', callback, options);
      },
      getcandles: function(options, callback) {
        publicApiCall(opts.baseUrlv2 + '/pub/market/GetTicks', callback, options);
      },
      buylimit: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/buylimit', callback, options);
      },
      buymarket: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/buymarket', callback, options);
      },
      selllimit: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/selllimit', callback, options);
      },
      tradesell: function(options, callback) {
        credentialApiCall(opts.baseUrlv2 + '/key/market/TradeSell', callback, options);
      },
      tradebuy: function(options, callback) {
        credentialApiCall(opts.baseUrlv2 + '/key/market/TradeBuy', callback, options);
      },
      sellmarket: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/sellmarket', callback, options);
      },
      cancel: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/cancel', callback, options);
      },
      getopenorders: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/market/getopenorders', callback, options);
      },
      getbalances: function(callback) {
        credentialApiCall(opts.baseUrl + '/account/getbalances', callback, {});
      },
      getbalance: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getbalance', callback, options);
      },
      getwithdrawalhistory: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getwithdrawalhistory', callback, options);
      },
      getdepositaddress: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getdepositaddress', callback, options);
      },
      getdeposithistory: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getdeposithistory', callback, options);
      },
      getorderhistory: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getorderhistory', callback, options || {});
      },
      getorder: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/getorder', callback, options);
      },
      withdraw: function(options, callback) {
        credentialApiCall(opts.baseUrl + '/account/withdraw', callback, options);
      }
    };
  }();
  
  module.exports = NodeBittrexApi;