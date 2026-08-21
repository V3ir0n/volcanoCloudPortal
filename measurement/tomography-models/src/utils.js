/**
 * Saves a blob as a file
 * @param {Blob} blob
 * @param {string} filename
 */
function saveBlob(blob, filename) {
    const link = document.createElement("a");
    link.style.display = "none";
    document.body.appendChild(link);

    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function saveString(text, filename) {
    saveBlob(new Blob([text], {type: "text/plain"}), filename);
}

function saveArrayBuffer(buffer, filename) {
    saveBlob(new Blob([buffer], {
        type: "application/octet-stream"
    }), filename);
}

export {saveBlob, saveString, saveArrayBuffer}