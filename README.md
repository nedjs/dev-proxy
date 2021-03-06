# dev-proxy

### Installation

I highly recommend you install it globally. `npm install -g`. Afterwards it can be accessed using the `dproxy` command

### Help text
```
  Usage: dproxy [options] <remote_host>

  Runs a local server which servers static content. If content does not exist or requests are made to the server which do not resolve to static content then the request is resolved using a remote server as specified.Requests are attempted to be resolved in the following order REGEX -> MAP -> LOCAL -> REMOTE

  Options:

    -V, --version               output the version number
    -t, --test                  I added some local stuff not checked in, feature flag!
    -p, --port <port>           Port for local server to run on - defaults to 3333 (default: 3333)
    -s, --secure                Add support for HTTP->HTTPS secure connection - defaults to false
    -d, --dir <path>            Server directory - defaults to ./ (default: ./)
    --cors                      Forcably overwrite CORS headers when XHR requests are detected. This will always allow full access to requested domai.
    --handler <path>            Javascript proxy handler file, use template: module.exports = { onRequest: function(request, response) {}, onResponse: function(request, response) {} } (default: null)
    -z, --compress              Add support for compression - defaults to true
    -r, --regex <expression>    Sends requests to the proxied domain if they match the expression without looking locally
    -m, --map <remote>,<local>  Maps a remote request to a local path. Remote path is expected to be a glob matching, eg: (static/*.txt).May be specified multiple times. If the local path is relative then it will be resolved to the <dir> param. Remote paths are not required to specify a leading '/' to be matched. (default: )
    -l, --logLevel [level]      Logging levels are as follows: 0=off 1=all 2=messages 4=REGEX 8=MAP 16=LOCAL 32=REMOTE. Levels are bit masked so you can use any combination. EG: 14=messages,REGEX,MAP - Defaults to 46 which is everything but LOCAL (default: 46)
    --no-color                  Removes color from the output
    -h, --help                  output usage information
```

### Basic command: 
`dproxy myhost.com`, *this assumes that `myhost.com` is accessable via http on port 80*.
You may then go to [http://localhost:3333/][1] and see `myhost.com`.

### Use case
Lets assume the following website structure for a front end which then uses an API:

```yaml
---Hosted on myhost.com
index.html
public
    js
      scripts.js
    css
      styles.css
```

Now you want to make some changes to `scripts.js` on your local machine but use the remote server for
api calls and other assets which are missing.

In an empty directory lets place our script file:

```bash
mkdir -p public/js
echo 'window.alert("hello world");' > public/js/scripts.js
dproxy myhost.com
```

-------

### Request handling priority

Each request send to the local server is sent through a series of handlers which may take the request.
The order of the handlers is as follows:


- **Handler file** - `--handler <path>` specifically the `middleware` function.
- **RegExp** - `-r, --regex <expression> ` when a request url matches the expression it is sent to the remote ignoring any local files
- **Map** - `-m, --map <remote>,<local>` maps a remote url to a local file
- **Local filesystem** - uses the current working directory to attempt to locate the request path and resolves if it exists
- **Proxy** - The final catch-all which will invoke the same request to the remote server and pipe the response.


-------

### Using a handler file

Handler files can be handy for customizing requests and responses. Most basic example of a handler file is:

```javascript
let requestIndex = 0;
module.exports = {
    /**
    * Prior to a request being sent to the remote server this function is invoked allowing
    * you to modify the request or responses.
    * 
    * @param proxyRequest The outgoing proxy request to the remote server
    * @param request The request of the local server
    * @param response The response of the local server
    */
    onProxyRequest: (proxyRequest, request, response) => {
        response['MyCustomIdentifier'] = ++requestIndex;
        console.log(`Requested ${request.url} ${response['MyCustomIdentifier']}`);
    },

    /**
    * A method to modify the response from a proxied server response prior to it being
    * sent to the local servers response.
    * 
    * @param proxyResponse The response from the remote server
    * @param request The request of the local server
    * @param response The response of the local server
    */
    onProxyResponse: (proxyResponse, request, response) => {
        console.log(`Finished ${request.url} ${response['MyCustomIdentifier']}`);
    },
	
    /**
    * Global middleware for all incoming requests and responses on the local server.
    * @param req Request object provided by Express
    * @param res Response object provided by Express
    * @param next Function to continue execution.
    */  
    middleware: (req, res, next) => {
        next();
        console.log(`request was handled by ${req.handledBy} using ${req.handledUsing}`)
    }
}
```

This prints a request and response with incrementing a request index. Invoke using

`dproxy stackoverflow.com -s --handler my-handler.js`
 
 Additionally you can see what each request was handled by uing the `handledBy` and `handledUsing` properties 
 on the `request` object. They will be of the following values
 
    handledBy = "proxy" | "local"
    handledUsing = "proxy" | "fs" | "map" | "regex"

-------

Alternatively you can place the file in a different folder and use the `-m,--map` option.

```bash
echo 'window.alert("hello world");' > myscript.js
dproxy -m "public/js/scripts.js","myscript.js" myhost.com
```

Then go to [http://localhost:3333/][1] and see the alert.


### Dealing with HTTPS connections.
There is no https support for the locally hosted server. However you can proxy am https server using the `-s --secure` option. For instance: `dproxy -s myhost.com` would proxy the following url `https://myhost.com/`. By adding the secure option the default port for the host will be changed to 443 instead of 80. 

[1]: http://localhost:3333/