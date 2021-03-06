var fs = require('fs')
var util = require('util')
var debounce = require('debounce')
var events = require('events')
var EventEmitter = events.EventEmitter

var outOfFileHandles = false

module.exports = function(opts) {
  return new FileWatcher(opts)
}

function FileWatcher(opts) {
  if (!opts) opts = {}
  if (opts.debounce === undefined) opts.debounce = 10
  if (opts.persistent === undefined) opts.persistent = true
  if (!opts.interval) opts.interval = 1000
  this.polling = opts.forcePolling
  this.opts = opts
  this.watchers = {}
}

util.inherits(FileWatcher, EventEmitter)

/**
 * Start watching the given file.
 */
FileWatcher.prototype.add = function(file) {
  var self = this

  // don't add files after we ran out of file handles
  if (outOfFileHandles && !this.polling) return

  // ignore files that don't exist or are already watched
  if (this.watchers[file] || !fs.existsSync(file)) return

  // remember the current mtime
  var mtime = fs.statSync(file).mtime

  // callback for both fs.watch and fs.watchFile
  function check() {
    fs.stat(file, function(e, stat) {

      if (!self.watchers[file]) return

      // close watcher and create a new one to work around fs.watch() bug
      // see https://github.com/joyent/node/issues/3172
      if (!self.polling) {
        self.remove(file)
        self.add(file)
      }

      if (!stat) {
        self.emit('change', file, { deleted: true })
      }
      else if (stat.isDirectory() || stat.mtime > mtime) {
        mtime = stat.mtime
        self.emit('change', file, stat)
      }
    })
  }

  if (this.polling) {
    fs.watchFile(file, this.opts, check)
    this.watchers[file] = { close: function() { fs.unwatchFile(file) }}
    return
  }

  try {
    // try using fs.watch ...
    this.watchers[file] = fs.watch(file, this.opts,
      debounce(check, this.opts.debounce)
    )
  }
  catch (err) {
    if (err.code == 'EMFILE') {
      if (this.opts.fallback !== false) {
        // emit fallback event if we ran out of file handles
        var count = this.poll()
        this.add(file)
        this.emit('fallback', count)
        return
      }
      outOfFileHandles = true
    }
    this.emit('error', err)
  }
}

/**
 * Switch to polling mode. This method is invoked internally if the system
 * runs out of file handles.
 */
FileWatcher.prototype.poll = function() {
  if (this.polling) return 0
  this.polling = true
  var watched = Object.keys(this.watchers)
  this.removeAll()
  watched.forEach(this.add, this)
  return watched.length
}

/**
 * Lists all watched files.
 */
FileWatcher.prototype.list = function() {
  return Object.keys(this.watchers)
}

/**
 * Stop watching the given file.
 */
FileWatcher.prototype.remove = function(file) {
  var watcher = this.watchers[file]
  if (!watcher) return
  delete this.watchers[file]
  watcher.close()
}

/**
 * Stop watching all currently watched files.
 */
FileWatcher.prototype.removeAll = function() {
  this.list().forEach(this.remove, this)
}
