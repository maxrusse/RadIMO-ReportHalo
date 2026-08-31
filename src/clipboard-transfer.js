function snapshotClipboard(clipboard) {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage(),
  };
}

function restoreClipboard(clipboard, snapshot) {
  const data = {};
  if (snapshot.text) data.text = snapshot.text;
  if (snapshot.html) data.html = snapshot.html;
  if (snapshot.rtf) data.rtf = snapshot.rtf;
  if (snapshot.image && !snapshot.image.isEmpty()) data.image = snapshot.image;
  if (Object.keys(data).length) clipboard.write(data);
  else clipboard.clear();
}

module.exports = { restoreClipboard, snapshotClipboard };
