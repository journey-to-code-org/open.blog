// Her photos in some text, in order (a job's Before and After follow them). Since R6 a photo shows
// as a card in place (word-box.js); this is the list behind it. DOM-free, tested.

const PHOTO = /^!\[((?:\\.|[^\]\\])*)\]\((\/images\/uploads\/[^)\s]+)\)[ \t]*$/;

/** The photos in some text, in order: { alt, url, line } (line counts from 0). */
export function photosIn(text) {
  return String(text || "").split("\n").flatMap((line, index) => {
    const match = PHOTO.exec(line.trim());
    return match ? [{ alt: match[1].replace(/\\(.)/g, "$1"), url: match[2], line: index }] : [];
  });
}
