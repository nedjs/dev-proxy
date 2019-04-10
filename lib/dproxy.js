var pack = require('../package.json');
var program = require('commander');
var express = require('express');
var cors = require('cors');
var colors = require('colors');
var fs = require('fs');
var path = require('path');
var util = require('util');
var proxy = require('http-proxy');
var https = require('https');
var nm = require('nanomatch');

var middleware = {
	errorHandler: require('errorhandler')
}

var remote_host, remote_port, protocol,
	RES_LOG_KEY = '__resKey', // each step can add in logging messages if they choose to, these are attached to the response object using these keys
	RES_MSG_LOG_KEY = '__resMsgKey';

// used as argument collector for commander
function collectMapArg(val, arr) {
	var localArg = val.split(',');
	if(localArg.length != 2) {
		console.error(("Illegal argument '" + val + "' expecting 2 values separated by a comma but got " + localArg.length).red);
		program.help();
	}
	arr.push(localArg);
	return arr;
}

program.version(pack.version)
	.arguments('<remote_host>')
	.action(function (host) {
		remote_host = host;
	})
	.description('Runs a local server which servers static content. If content does not exist or requests are made ' +
		'to the server which do not resolve to static content then the request is resolved using a remote server as specified.' +
		'Requests are attempted to be resolved in the following order REGEX -> MAP -> LOCAL -> REMOTE')
	.option('-t, --test', 'I added some local stuff not checked in, feature flag!', false)
	.option('-p, --port <port>', 'Port for local server to run on - defaults to 3333', 3333)
	.option('-s, --secure', 'Add support for HTTP->HTTPS secure connection - defaults to false', false)
	.option('-d, --dir <path>', 'Server directory - defaults to ./', './')
	.option('--cors', 'Forcably overwrite CORS headers when XHR requests are detected. This will always allow full access to requested domai.', false)
	.option('--handler <path>', 'Javascript proxy handler file, use template: module.exports = { onRequest: function(request, response) {}, onResponse: function(request, response) {} }', null)
	.option('-z, --compress', 'Add support for compression - defaults to true', true)
	.option('-r, --regex <expression>', 'Sends requests to the proxied domain if they match the expression without looking locally', undefined)
	.option('-m, --map <remote>,<local>', 'Maps a remote request to a local path. Remote path is expected to be a glob matching, eg: (static/*.txt).'+
		'May be specified multiple times. If the local path is relative then it will be resolved to the <dir> param. '+
		'Remote paths are not required to specify a leading \'/\' to be matched.', collectMapArg, [])
	.option('-l, --logLevel [level]', 'Logging levels are as follows: 0=off 1=all 2=messages 4=REGEX 8=MAP 16=LOCAL 32=REMOTE. '+
		'Levels are bit masked so you can use any combination. EG: 14=messages,REGEX,MAP - Defaults to 46 which is everything but LOCAL', 2+4+8+32)
	.option('--no-color', 'Removes color from the output')
	.parse(process.argv);


if (!remote_host) {
	program.outputHelp();
	process.exit(1);
}

if(remote_host.indexOf('://') >= 0) {
	console.log("'remote_host' parameter is incorrect, please use just the domain name and not the protocol. For https add the -s parameter.");
	process.exit(1);
}



var LOG_MESSAGES, LOG_REGEXP, LOG_MAP, LOG_LOCAL, LOG_REMOTE;
if(program.logLevel) {
	program.logLevel = +program.logLevel;
	if(program.logLevel == 1) program.logLevel = 2+4+8+16+32;

	LOG_MESSAGES= (program.logLevel & 2) == 2;
	LOG_REGEXP 	= (program.logLevel & 4) == 4;
	LOG_MAP 	= (program.logLevel & 8) == 8;
	LOG_LOCAL 	= (program.logLevel & 16) == 16;
	LOG_REMOTE 	= (program.logLevel & 32) == 32;
}

if (program.secure === true) {
	remote_port = 443;
	protocol = "https";
} else {
	remote_port = 80;
	protocol = "http";
}

if((ix=remote_host.lastIndexOf(':')) > 0) {
	remote_port = remote_host.substring(ix+1);
	remote_host = remote_host.substring(0, ix);
}

// proxy server where we will make our requests to
// needs to rewrite https to http connections.
var proxyServer = proxy.createProxyServer({
	target: protocol+"://"+remote_host+':'+remote_port,
	protocolRewrite: 'http',
	autoRewrite: true,
	headers: {
		host: remote_host,
	}
});

if(program.handler) {
	addCustomRequestHandler(proxyServer);
}
if(program.cors) {
	addCorsRequestHandler(proxyServer);
}


// find and replcae any set cookies which want a secure only connection. Strip that out cause we want an insecure connection on our end
proxyServer.on('proxyRes', function (proxyRes, req, res) {
	if((setC = proxyRes.headers['set-cookie']) && setC.length) {
		for(var k in setC) {
			setC[k] = setC[k].replace(/(\sSecure;?)|(^Secure;?)/gm, '');
		}
	}

	// look for location headers which would redirect
	if((loc = proxyRes.headers['location']) && loc.length) {
		// quote the remote_host regex
		var domainExp = remote_host.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
		// regex for testing and replacing location header with our localhost domain
		var regexp = new RegExp("(http[s]?)\:\/\/"+domainExp+"(?:\:(\d+))?[\/](.*)?");
		if(loc.match(regexp)) {
			// replace location with our local domain
			proxyRes.headers['location'] = loc.replace(regexp, "http://localhost:"+program.port+"/$3");
		}
	}
});



// setup express website to handle requests app
var app = express();
app.disable('x-powered-by');


if (program.compress === true) {
	app.use(express.compress());
}

// logging method
app.use(function(req, res, next){
	res.on('finish', function() {
		if(res[RES_LOG_KEY]) {
			var colorMethod = String(req.method);
			switch(req.method) {
				case 'GET': 	colorMethod = colorMethod.white; break;
				case 'POST': 	colorMethod = colorMethod.yellow; break;
				case 'HEAD': 	colorMethod = colorMethod.gray; break;
				case 'OPTIONS': colorMethod = colorMethod.white; break;
				default: 		colorMethod = colorMethod.white; break;
			}
			console.log(colorMethod + " - " + res.statusCode + " - " + res[RES_LOG_KEY] + " - " + req.url + (res[RES_MSG_LOG_KEY]||''));
		}
	});
	next();
});

var proxy_regex = program.regex ? new RegExp(program.regex) : null;
// check if proxy regex matches
app.use(function(req, res, next) {
	if(proxy_regex && req.url.match(proxy_regex)) {
		if(LOG_REGEXP) res[RES_LOG_KEY] = 'REGEXP'.green;
		return proxyServer.web(req, res);
	} else {
		next();
	}
});

// check if a mapping exists for the request
app.use(function(req, res, next) {
	if(program.map && program.map.length > 0) {
		for(var i=0;i<program.map.length;i++) {
			// for each entry check if the path matches the remote path
			var entry = program.map[i];
			if(entry[0] === req.path || nm.isMatch(req.path.substring(1), entry[0])) {
				if(LOG_MAP) {
					res[RES_LOG_KEY] = '   MAP'.magenta;
					res[RES_MSG_LOG_KEY] = ' > ' + entry[1].blue;
				}
				return res.sendFile(fs.realpathSync(path.join(program.dir, entry[1])));
			}
		}
	}
	next();
});

// static serving of content
app.use(function(req, res, next) {
	if(LOG_LOCAL) res[RES_LOG_KEY] = ' LOCAL'.blue;
	return express.static(fs.realpathSync(program.dir))(req, res, next);
});

// fallback proxy request
app.use(function(req, res, next){
	if(LOG_REMOTE) res[RES_LOG_KEY] = 'REMOTE'.red;
	return proxyServer.web(req, res);
});

app.use(middleware.errorHandler({
	dumpExceptions: true,
	showStack: true
}));

if(LOG_MESSAGES) {
	console.log("Listening on port "+String(program.port).green+", proxy domain: '"+(remote_host + ":"+ remote_port).green+"', secure:"+(program.secure?'true':'false'));
}
app.listen(parseInt(program.port, 10));



function addCustomRequestHandler(proxyServer) {
	let handlerFile = path.isAbsolute(program.handler) ? program.handler : path.relative(fs.realpathSync(process.cwd()), program.handler);
	console.log('Loading handler: ' + handlerFile);
	let requestHandler = require(handlerFile);

	if(!requestHandler) {
		console.error("Request handler is expected to be an object, got " + (typeof requestHandler));
		process.exit(1);
	}

	if(requestHandler.onResponse && typeof requestHandler.onResponse !== "function") {
		console.error('Request handler function "onResponse" is not a function.');
		process.exit(1);
	}
	if(requestHandler.onRequest && typeof requestHandler.onRequest !== "function") {
		console.error('Request handler function "onRequest" is not a function.');
		process.exit(1);
	}

	proxyServer.on('proxyReq', function(proxyReq, req, res, options) {
		proxyReq.setHeader('X-Proxy', 'dev-proxy');
		if(requestHandler && requestHandler.onRequest) {
			requestHandler.onRequest(proxyReq, res);
		}
	});
	proxyServer.on('proxyRes', function(proxyRes, req, res, options) {
		res.setHeader('X-Proxy', 'dev-proxy');
		if(requestHandler && requestHandler.onResponse) {
			requestHandler.onResponse(req, res);
		}
	});
}

function addCorsRequestHandler(proxyServer) {
	proxyServer.on('proxyRes', function(proxyRes, req, res, options) {
		if(req.headers['origin']) {
			res.setHeader('Access-Control-Allow-Origin', request.headers['origin']);
			res.setHeader('Access-Control-Allow-Credentials', 'true');
		}
	});
}