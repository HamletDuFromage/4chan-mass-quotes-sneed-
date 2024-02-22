import {
  createQuotes,
} from './quotes';

import {
  initDB,
  saveFile,
  loadFile,
} from './store';

import {
  fakeFilename,
  anonHash,
  fileConvert,
  fileCompress,
  drawWatermark,
} from './file';

import {
  getBoard,
  getBoardInfo,
} from './board';

import {
  debugLog,
} from './misc';

import {
  slideCaptcha,
} from './captcha';

const is4chanX = (document.querySelector("html[class~='fourchan-x'") !== null);
const isMobile = (document.getElementById('boardNavMobile') !== null && window.getComputedStyle(document.getElementById('boardNavMobile')).display !== 'none');

/*
 * default values, make sure its the same as in popup.js
 */
const store = {
  fakeFilename: 'off',
  watermark: 'off',
  anonymizeFileHash: false,
  bypassBanEvasion: false,
  bypassWordfilter: true,
  slideCaptcha: true,
  optionsCheckboxes: false,
  rememberFile: false,
  quoteBottom: false,
  quoteFormat: 'single',
};

const kymRegex = /^(?=(?:.*\d.*){1})[a-f0-9]{3}\.[a-zA-Z]+$/;

function spotKym(element) {
  let filenameDOMs = null;
  if (is4chanX) {
    filenameDOMs = element.querySelectorAll("div[class~='fileText'] > span[class~='file-info'] > a[target]");
  } else {
    filenameDOMs = element.querySelectorAll("div[class~='fileText'] > a[target]");
  }
  for (let i = 0; i < filenameDOMs.length; ++i) {
    if (kymRegex.test(filenameDOMs[i].textContent)) {
      if (isMobile) {
        const fileDiv = filenameDOMs[i].parentElement.parentElement;
        if (fileDiv) {
          const fileInfo = fileDiv.getElementsByClassName('mFileInfo');
          if (fileInfo && fileInfo[0]) {
            fileInfo[0].style.backgroundColor = '#FDFF47';
          }
        }
      } else {
        filenameDOMs[i].style.backgroundColor = '#FDFF47';
      }
    }
  }
}

function isFileInput(e) {
  const result = (
    typeof e.type !== 'undefined'
        && e.nodeType === Node.ELEMENT_NODE
        && e.tagName === 'INPUT'
        && /file(?:s)?/i.test(e.type)
  );
  if (result) {
    debugLog('Found file input: ', e);
  }
  return result;
}

function isOptionsField(e) {
  const result = (
    typeof e.type !== 'undefined'
        && e.nodeType === Node.ELEMENT_NODE
        && e.tagName === 'INPUT'
        && e.type === 'text'
        && e.name === 'email'
  );
  if (result) {
    debugLog('Found options field: ', e);
  }
  return result;
}

function isCommentArea(e) {
  const result = (
    typeof e.type !== 'undefined'
        && e.nodeType === Node.ELEMENT_NODE
        && e.tagName === 'TEXTAREA'
        && (e.getAttribute('name') === 'com' || e.getAttribute('data-name') === 'com')
  );
  if (result) {
    debugLog('Found comment textarea: ', e);
  }
  return result;
}

function createFileList(files) {
  // make a copy of an array?
  // i think this also allows files to be an array of files or multiple file arguments
  // eslint-disable-next-line prefer-rest-params
  files = [].slice.call(Array.isArray(files) ? files : arguments);

  const dt = new DataTransfer();

  for (let i = 0; i < files.length; ++i) {
    if (!(files[i] instanceof File)) {
      throw new TypeError('expected argument to FileList is File or array of File objects');
    }
    dt.items.add(files[i]);
  }

  return dt.files;
}

function fileChanged(evt) {
  const element = evt.target;
  if (element.files.length === 0) {
    return;
  }
  const board = getBoard();
  if (!board) {
    return;
  }
  fileConvert(element.files[0]).then((convertedFile) => {
    element.files = createFileList(convertedFile);

    const maxImageSize = getBoardInfo(board).maxImageFilesize;

    fileCompress(element.files[0], maxImageSize).then((compressedFile) => {
      element.files = createFileList(compressedFile);

      if (store.rememberFile) {
        saveFile(element.files[0]).catch(debugLog);
      }

      let hashPromise = Promise.resolve();

      if (store.anonymizeFileHash) {
        hashPromise = new Promise((resolve) => {
          anonHash(element.files[0]).then((hashFile) => {
            element.files = createFileList(hashFile);
            resolve();
          });
        });
      }

      hashPromise.then(() => {
        let watermarkPromise = Promise.resolve();

        if (store.watermark !== 'off') {
          watermarkPromise = new Promise((resolve) => {
            drawWatermark(element.files[0], store.watermark).then((watermarkFile) => {
              if (watermarkFile !== undefined) {
                element.files = createFileList(watermarkFile);
              }
              resolve();
            });
          });
        }

        watermarkPromise.then(() => {
          if (store.fakeFilename !== 'off') {
            element.files = createFileList(fakeFilename(element.files[0], store.fakeFilename));
          }
        });
      });
    });
  });
}

function bypassWordFilters(text) {
  const board = getBoard();
  const wordFilters = getBoardInfo(board).wordFilters;

  let newText = text;

  for (let i = 0; i < wordFilters.length; ++i) {
    const pattern = wordFilters[i];
    newText = newText.replace(pattern, (match /* , offset, string */) => {
      // check if we have a homoglyph
      // r9k doesn't allow non ascii
      if (board !== 'r9k') {
        const replacements = {
          C: 'Ϲ',
          F: 'Ϝ',
          H: 'Η',
          K: 'Κ',
          M: 'M',
          N: 'Ν',
          O: 'ⵔ',
          S: 'Տ',
          Y: 'Ү',
          a: 'ä',
          c: 'ϲ',
          h: 'հ',
          k: 'ƙ',
          n: 'ᥒ',
          o: '𐐬',
          p: 'ρ',
          s: '𐑈',
        };

        for (let j = match.length - 1; j >= 0; --j) {
          const letter = match[j];
          if (replacements[letter] !== undefined) {
            return match.slice(0, j) + replacements[letter] + match.slice(j + 1);
          }
        }
      }

      // check if the filter is a phrase and can be bypassed by
      // inserting apostrophe before last word
      if (match.split(' ').length > 1) {
        const lastSpaceIndex = match.lastIndexOf(' ');
        const addedSymbol = `${match.slice(0, lastSpaceIndex)} '${match.slice(lastSpaceIndex + 1)}`;
        pattern.lastIndex = 0;
        if (!pattern.test(addedSymbol)) {
          return addedSymbol;
        }
      }

      // check if the filter can be bypassed by changing the case of the last letter
      if (!pattern.ignoreCase) {
        let lastLetter = match.slice(-1);

        if (lastLetter >= 'a' && lastLetter <= 'z') lastLetter = lastLetter.toUpperCase();
        else if (lastLetter >= 'A' && lastLetter <= 'Z') lastLetter = lastLetter.toLowerCase();

        const caseChanged = match.slice(0, -1) + lastLetter;

        pattern.lastIndex = 0;
        if (!pattern.test(caseChanged)) {
          return caseChanged;
        }
      }

      // check if the filter can be bypassed by an underscore prefix
      const prefixed = `_${match}`;
      pattern.lastIndex = 0;
      if (!pattern.test(prefixed)) {
        return prefixed;
      }

      return match;
    });
  }
  return newText;
}

function commentChanged(evt) {
  const element = evt.target;
  if (store.bypassWordfilter) {
    element.value = bypassWordFilters(element.value);
  }
}

function gotFileInput(e) {
  e.addEventListener('change', fileChanged);
  if (store.rememberFile) {
    loadFile().then((rememberedFile) => {
      e.files = createFileList(rememberedFile);

      let hashPromise = Promise.resolve();

      if (store.anonymizeFileHash) {
        hashPromise = new Promise((resolve) => {
          anonHash(e.files[0]).then((hashFile) => {
            e.files = createFileList(hashFile);
            resolve();
          });
        });
      }

      hashPromise.then(() => {
        let watermarkPromise = Promise.resolve();

        if (store.watermark !== 'off') {
          watermarkPromise = new Promise((resolve) => {
            drawWatermark(e.files[0], store.watermark).then((watermarkFile) => {
              if (watermarkFile !== undefined) {
                e.files = createFileList(watermarkFile);
              }
              resolve();
            });
          });
        }

        watermarkPromise.then(() => {
          if (store.fakeFilename !== 'off') {
            e.files = createFileList(fakeFilename(e.files[0], store.fakeFilename));
          }
        });
      });
    }).catch(debugLog);
  }
}

function createButton(parentNode, label, title, listener) {
  const btn = document.createElement('span');
  btn.classList.add('mrBtn');
  btn.textContent = label;
  btn.id = `${title.toLowerCase().replaceAll(' ', '-')}-btn`;
  btn.title = title;
  parentNode.appendChild(btn);
  btn.addEventListener('click', listener);
}

function addQuotesText(e, action) {
  if (e.value && e.value.slice(-1) !== '\n') e.value += '\n';
  const str = createQuotes(action, store.quoteFormat, store.quoteBottom);
  e.value += str;
  e.scrollTop = e.scrollHeight;
  e.focus();
}

function gotTextArea(e) {
  e.classList.add('comtxt');
  e.addEventListener('change', commentChanged);

  // build UI after comment textarea
  const ui = document.createElement('span');

  createButton(ui, '🗑️', 'Clear Text', () => {
    e.value = '';
    e.focus();
  });

  createButton(ui, '📋', 'Paste from Clipboard', () => {
    navigator.clipboard.readText().then((txt) => {
      if (e.value && e.value.slice(-1) !== '\n') e.value += '\n';
      e.value += txt;
      e.scrollTop = e.scrollHeight;
      e.focus();
    });
  });

  createButton(ui, '🍪', 'Delete Cookie', () => {
    debugLog('Deleting 4chan_pass cookie');
    document.cookie = '4chan_pass=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.4channel.org';
    document.cookie = '4chan_pass=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.4chan.org';
  });

  createButton(ui, '⚔️', 'Mass Reply', () => {
    addQuotesText(e, 'regular');
  });

  createButton(ui, '😮', 'Soyquote', () => {
    e.value = e.value.replace(/>>(\d+)\s*/g, (match, repl, offset, value) => {
      let str = (offset && value.charAt(offset - 1) !== '\n') ? '\n' : '';
      str += `>${document.getElementById(`m${repl}`).innerText
        .replaceAll('\n', '\n>')}`;
      if (offset + match.length + 1 < value.length) str += '\n';
      return str;
    });
    e.scrollTop = e.scrollHeight;
    e.focus();
  });

  createButton(ui, '🖼️', 'Soyquote Filename', () => {
    e.value = e.value.replace(/>>(\d+)\s*/g, (match, repl) => {
      const fileText = document.getElementById(`fT${repl}`);
      if (!fileText) return '';

      if (is4chanX) {
        const fileTextA = fileText.children[0].children[0];
        const fnfull = fileTextA.getElementsByClassName('fnfull')[0];
        return `>${(fnfull || fileTextA).textContent}\n`;
      }
      const fileName = fileText.children[0];
      return `>${fileName.title ? fileName.title : fileName.textContent}\n`;
    });
    e.scrollTop = e.scrollHeight;
    e.focus();
  });

  createButton(ui, '☝️', "Check 'em", () => {
    addQuotesText(e, 'dubs');
  });

  createButton(ui, '🏷️', 'Spoof Filename', () => {
    const input = e.parentElement.parentElement.querySelector('[type=file]');
    let file = input.files[0];
    if (file !== undefined) {
      file = fakeFilename(file, (store.fakeFilename !== 'off' ? store.fakeFilename : 'unix'));
      input.files = createFileList(file);
    }
  });

  createButton(ui, '#️', 'Anonymize File Hash', () => {
    const input = e.parentElement.parentElement.querySelector('[type=file]');
    const file = input.files[0];
    if (file !== undefined) {
      anonHash(file).then((anonFile) => {
        input.files = createFileList(anonFile);
      });
    }
  });

  if (window.location.href.includes('/thread/')) {
    const board = getBoard();
    const boardInfo = getBoardInfo(board);

    if (boardInfo.hasUserIDs) {
      createButton(ui, '🏆', 'Rankings', () => {
        addQuotesText(e, 'rankings');
      });
      // this emoji doesn't work on win 7
      createButton(ui, '1️⃣', 'Quote 1pbtIDs', () => {
        addQuotesText(e, '1pbtid');
      });
    }

    if (boardInfo.hasBoardFlags) {
      createButton(ui, '🏁', 'Quote Memeflags', () => {
        addQuotesText(e, 'memeflags');
      });
    }
    createButton(ui, '💩', 'KYM', () => {
      addQuotesText(e, 'kym');
    });
  }
  e.parentNode.parentNode.insertBefore(ui, e.parentNode.nextSibling);
}

function createOptionCheckbox(parentNode, option) {
  const span = document.createElement('span');
  span.style.paddingRight = '3px';

  // 4chan's default extension copies quick reply fields from normal reply form
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('onchange', `(() => {
    const options = this.parentNode.parentNode.parentNode.children[0];
    if (this.checked) {
      options.value += '${option} ';
    } else {
      options.value = options.value.replace('${option} ', '');
    }
  })()`);

  const label = document.createElement('label');
  label.appendChild(input);
  label.innerHTML += option;

  span.appendChild(label);
  parentNode.appendChild(span);
}

function gotOptionsField(e) {
  if (store.optionsCheckboxes) {
    e.style.display = 'none';
    createOptionCheckbox(e.parentNode, 'sage');
    createOptionCheckbox(e.parentNode, 'fortune');
    createOptionCheckbox(e.parentNode, 'since4pass');
  }
}

function mutationChange(mutations) {
  mutations.forEach((mutation) => {
    if (mutation.target
        && mutation.target.className.indexOf('postInfo') !== -1
        && mutation.target.parentElement) {
      spotKym(mutation.target.parentElement);
      return;
    }

    /*
     * Detect Captcha loaded
     * (its ok to check via ElementById comparsion , because only one Captcha
     *  can be loaded on the site at once)
     */
    if (store.slideCaptcha) {
      if (mutation.target
        && mutation.target.id === 't-load'
        && mutation.removedNodes
        && mutation.removedNodes[0].data === 'Loading'
      ) {
        const tfg = document.getElementById('t-fg');
        const tbg = document.getElementById('t-bg');
        const tslider = document.getElementById('t-slider');
        const tresp = document.getElementById('t-resp');
        slideCaptcha(tfg, tbg, tslider, tresp);
        return;
      }
    }
    /*
     * Detect and hook into other stuff we need, like reply box or floating
     * QuickReplyBox. There can be multiple of those open together,
     * so we get each when it appears and don't go for IDs
     */
    const nodes = mutation.addedNodes;
    for (let n = 0; n < nodes.length; n++) {
      const node = nodes[n];
      if (isFileInput(node)) {
        // if element itself is input=file
        gotFileInput(node);
      } else if (isCommentArea(node)) {
        // if element itself is comment textarea
        gotTextArea(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // search child nodes for input=file and comment texarea
        let nodesl = node.getElementsByTagName('input');
        for (let i = 0; i < nodesl.length; i++) {
          if (isFileInput(nodesl[i])) {
            gotFileInput(nodesl[i]);
          }
        }
        nodesl = node.getElementsByTagName('textarea');
        for (let i = 0; i < nodesl.length; i++) {
          if (isCommentArea(nodesl[i])) {
            gotTextArea(nodesl[i]);
          }
        }
      }
    }
  });
}

browser.runtime.onMessage.addListener((message) => {
  const str = createQuotes(message.command, store.quoteFormat, store.quoteBottom);
  return Promise.resolve({ response: str });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
  }

  const storeValues = Object.keys(store);
  for (let i = 0; i < storeValues.length; i++) {
    const key = storeValues[i];
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      store[key] = changes[key].newValue;
    }
  }
});

browser.storage.local.get(store).then((item) => {
  const storeValues = Object.keys(store);
  for (let i = 0; i < storeValues.length; i++) {
    const key = storeValues[i];
    store[key] = Object.prototype.hasOwnProperty.call(item, key) ? item[key] : false;
  }

  spotKym(document);

  initDB().catch(debugLog).then(() => {
    let inputs = document.getElementsByTagName('input');
    for (let i = 0; i < inputs.length; i++) {
      if (isFileInput(inputs[i])) {
        gotFileInput(inputs[i]);
      } else if (isOptionsField(inputs[i])) {
        gotOptionsField(inputs[i]);
      }
    }
    inputs = document.getElementsByTagName('textarea');
    for (let i = 0; i < inputs.length; i++) {
      if (isCommentArea(inputs[i])) {
        gotTextArea(inputs[i]);
      }
    }
  });

  const observer = new MutationObserver((mutations) => {
    mutationChange(mutations);
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
  });
}, (error) => {
  debugLog(`Error getting local storage: ${error}`);
});
