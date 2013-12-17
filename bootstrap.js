const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;;
var DEBUG, TapTranslate, Translation, install, requestBuilder, settingsObserver, shutdown, startup, uninstall, utils, windowListener;

Cu["import"]("resource://gre/modules/Services.jsm");

DEBUG = false;

TapTranslate = {
  _prefsBranch: "extensions.taptranslate.",
  _prefs: null,
  _contextMenus: [],
  init: function() {
    this._setDefaultPrefs();
    return this._prefs = Services.prefs.getBranch(this._prefsBranch);
  },
  uninit: function() {
    return this._prefs = null;
  },
  setTranslationLanguage: function(language) {
    return this._prefs.setCharPref("translation_language", language);
  },
  showTranslatedLanguage: function() {
    return this._prefs.getBoolPref("show_translated_language");
  },
  _setDefaultPrefs: function() {
    var prefs;
    prefs = Services.prefs.getDefaultBranch(this._prefsBranch);
    prefs.setCharPref("translation_language", "en");
    return prefs.setBoolPref("show_translated_language", false);
  },
  install: function() {},
  uninstall: function() {},
  load: function(aWindow) {
    if (!aWindow) {
      return;
    }
    return this.setupUI(aWindow);
  },
  unload: function(aWindow) {
    if (!aWindow) {
      return;
    }
    return this.cleanupUI(aWindow);
  },
  setupUI: function(aWindow) {
    var menu, searchOnContext,
      _this = this;
    searchOnContext = {
      matches: function(aElement, aX, aY) {
        return aWindow.SelectionHandler.shouldShowContextMenu(aX, aY);
      }
    };
    menu = aWindow.NativeWindow.contextmenus.add(utils.t("Translate"), searchOnContext, function(target) {
      var text;
      text = utils.getSelectedText(aWindow);
      return _this._translate(aWindow, text);
    });
    return this._contextMenus.push(menu);
  },
  cleanupUI: function(aWindow) {
    this._contextMenus.forEach(function(menu) {
      return aWindow.NativeWindow.contextmenus.remove(menu);
    });
    return this._contextMenus = [];
  },
  _translate: function(aWindow, text) {
    var request, translationLanguage,
      _this = this;
    translationLanguage = this._prefs.getCharPref("translation_language");
    request = requestBuilder.build(translationLanguage, function(event) {
      var translation;
      translation = JSON.parse(event.target.responseText);
      return _this._showTranslation(aWindow, translation);
    }, function() {
      return _this._translationErrorNotify(aWindow);
    });
    return request.send("text=" + (encodeURIComponent(text)));
  },
  _showTranslation: function(aWindow, translation) {
    translation = new Translation(translation);
    return translation.show(aWindow);
  },
  _translationErrorNotify: function(aWindow) {
    var msg;
    msg = utils.t("TranslationRequestError");
    return aWindow.NativeWindow.toast.show(msg);
  }
};

Translation = (function() {
  function Translation(response) {
    this.response = response;
  }

  Translation.prototype.show = function(aWindow) {
    var _this = this;
    return aWindow.NativeWindow.doorhanger.show(this._message(), "Translation", [
      {
        label: utils.t("Copy"),
        callback: function() {
          _this._copyToClipboard();
          return aWindow.NativeWindow.toast.show(utils.t("TranslationCopied"), "short");
        }
      }, {
        label: utils.t("Close")
      }
    ]);
  };

  Translation.prototype.main = function() {
    return this.response.sentences.map(function(sentence) {
      return sentence.trans;
    });
  };

  Translation.prototype.secondary = function() {
    return this.response.dict;
  };

  Translation.prototype.source = function() {
    return utils.t(this.response.src);
  };

  Translation.prototype._message = function() {
    var msg;
    msg = "";
    if (TapTranslate.showTranslatedLanguage()) {
      msg += this.source();
      msg += "\n\n";
    }
    msg += this.main().join("");
    if (this.secondary()) {
      msg += "\n";
      this.secondary().forEach(function(part) {
        var pos;
        msg += "\n";
        pos = utils.capitalize(part.pos);
        return msg += "" + pos + ": " + (part.terms.join(", "));
      });
    }
    return msg;
  };

  Translation.prototype._copyToClipboard = function() {
    return utils.copyToClipboard(this.main());
  };

  return Translation;

})();

requestBuilder = {
  url: "http://translate.google.com/translate_a/t",
  XMLHttpRequest: Cc["@mozilla.org/xmlextras/xmlhttprequest;1"],
  createXMLHttpRequest: function(params) {
    return Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  },
  build: function(translationLanguage, successHandler, errorHandler) {
    var param, params, query, request, url, value;
    params = {
      client: "p",
      sl: "auto",
      tl: translationLanguage
    };
    query = [];
    for (param in params) {
      value = params[param];
      query.push("" + param + "=" + (encodeURIComponent(value)));
    }
    query = query.join("&");
    url = "" + this.url + "?" + query;
    request = this.createXMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
    request.addEventListener("load", successHandler, false);
    request.addEventListener("error", errorHandler, false);
    return request;
  }
};

utils = {
  _translations: null,
  _translations_uri: "chrome://taptranslate/locale/taptranslate.properties",
  log: function(msg) {
    if (!DEBUG) {
      return;
    }
    msg = "log: " + msg;
    Services.console.logStringMessage(msg);
    return Cu.reportError(msg);
  },
  inspect: function(object, prefix) {
    var key, type, value, _results;
    if (prefix == null) {
      prefix = "";
    }
    if (!DEBUG) {
      return;
    }
    _results = [];
    for (key in object) {
      value = object[key];
      type = typeof value;
      if (this.isObject(value)) {
        _results.push(this.inspect(value, "" + prefix + "{" + key + "} "));
      } else {
        _results.push(this.log("" + prefix + key + " => (" + type + ") value"));
      }
    }
    return _results;
  },
  isObject: function(obj) {
    return !!obj && obj.constructor === Object;
  },
  t: function(name) {
    this._translations || (this._translations = Services.strings.createBundle(this._translations_uri));
    try {
      return this._translations.GetStringFromName(name);
    } catch (_error) {
      return name;
    }
  },
  getSelectedText: function(aWindow) {
    var selection, win;
    win = aWindow.BrowserApp.selectedTab.window;
    selection = win.getSelection();
    if (!selection || selection.isCollapsed) {
      return "";
    }
    return selection.toString().trim();
  },
  capitalize: function(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  },
  copyToClipboard: function(text) {
    this._clipboardHelper || (this._clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper));
    return this._clipboardHelper.copyString(text);
  }
};

install = function(aData, aReason) {
  return TapTranslate.install();
};

uninstall = function(aData, aReason) {
  if (aReason === ADDON_UNINSTALL) {
    return TapTranslate.uninstall;
  }
};

startup = function(aData, aReason) {
  var win, windows;
  settingsObserver.init();
  TapTranslate.init();
  windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    win = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    if (win) {
      TapTranslate.load(win);
    }
  }
  return Services.wm.addListener(windowListener);
};

shutdown = function(aData, aReason) {
  var win, windows;
  if (aReason === APP_SHUTDOWN) {
    return;
  }
  Services.wm.removeListener(windowListener);
  windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    win = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    if (win) {
      TapTranslate.unload(win);
    }
  }
  TapTranslate.uninit();
  return settingsObserver.uninit();
};

windowListener = {
  onOpenWindow: function(aWindow) {
    var win;
    win = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    return win.addEventListener("UIReady", function() {
      win.removeEventListener("UIReady", arguments.callee, false);
      return TapTranslate.load(win);
    }, false);
  },
  onCloseWindow: function() {},
  onWindowTitleChange: function() {}
};

settingsObserver = {
  init: function() {
    return Services.obs.addObserver(this, "addon-options-displayed", false);
  },
  uninit: function() {
    return Services.obs.removeObserver(this, "addon-options-displayed");
  },
  observe: function(subject, topic, data) {
    return this.fixTranslationMenu(subject.QueryInterface(Ci.nsIDOMDocument));
  },
  fixTranslationMenu: function(doc) {
    var menu;
    menu = doc.getElementById("tap-translate-translation-language-selector");
    if (!menu) {
      return;
    }
    return menu.watch("selectedIndex", function(prop, oldIndex, newIndex) {
      var language;
      language = menu.getItemAtIndex(newIndex).value;
      TapTranslate.setTranslationLanguage(language);
      return newIndex;
    });
  }
};
