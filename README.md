# dev-proxy

### Installation

I highly recommend you install it globally. `npm install -g`. Afterwards it can be accessed using the `dproxy` command

### Help text
```
  Usage: dproxy [options] <remote_host>

  Runs a local server which servers static content. If content does not exist or requests are made to the server which do not resolve to static content then the request is resolved using a remote server as specified.Requests are attempted to be resolved in the following
order REGEX -> MAP -> LOCAL -> REMOTE

  Options:

    -h, --help                  output usage information
    -V, --version               output the version number
    -p, --port <port>           Port for local server to run on - defaults to 3333
    -s, --secure                Add support for HTTP->HTTPS secure connection - defaults to false
    -d, --dir <path>            Server directory - defaults to ./
    -z, --compress              Add support for compression - defaults to true
    -r, --regex <expression>    Sends requests to the proxied domain if they match the expression without looking locally
    -m, --map <remote>,<local>  Maps a remote request to a local path. May be specified multiple times. If the local path is relative then it will be resolved to the <dir> param. Remote paths are not required to specify a leading '/' to be matched.
    -l, --logLevel [level]      Logging levels are as follows: 0=off 1=all 2=messages 4=REGEX 8=MAP 16=LOCAL 32=REMOTE. Levels are bit masked so you can use any combination. EG: 14=messages,REGEX,MAP - Defaults to 46 which is everything but LOCAL
    --no-color                  Removes color from the output
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

Alternatively you can place the file in a different folder and use the `-m,--map` option.

```bash
echo 'window.alert("hello world");' > myscript.js
dproxy -m "public/js/scripts.js","myscript.js" myhost.com
```

Then go to [http://localhost:3333/][1] and see the alert.


### Dealing with HTTPS connections.
There is no https support for the locally hosted server. However you can proxy am https server using the `-s --secure` option. For instance: `dproxy -s myhost.com` would proxy the following url `https://myhost.com/`. By adding the secure option the default port for the host will be changed to 443 instead of 80. 

[1]: http://localhost:3333/