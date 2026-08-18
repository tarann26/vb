// What a clipboard's plain text becomes when it lands in the writing column.
//
// THE RICH FLAVOUR IS NEVER ASKED FOR. Everything about "paste strips
// formatting" is true by construction here rather than by cleanup afterwards,
// which is the call EditableText.tsx:185-208 already argues at length one
// level down: the browser's own default paste action can drop a foreign
// font, a bold run and a line break straight into an editable host, and a
// surface that cleaned that up afterwards would still have shown it to her in
// between. The surface reads `text/plain` and inserts a TEXT NODE, so nothing
// this module produces has ever been markup.
//
// The one judgement left is where a paragraph ends, and it is not the
// judgement it first looks like.
export function pasteChunks(text: string): string[] {
  // A blank line separates paragraphs; a single line break inside one is a
  // SOFT WRAP and becomes a space. Word and Google Docs both produce the
  // first shape. A web page copied at a narrow column width produces the
  // second -- and turning each of its wrapped lines into its own paragraph is
  // the failure a reader notices immediately, because it survives the publish
  // and reaches the live post as a column of orphaned half-sentences.
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((chunk) => chunk.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim())
    // A chunk of nothing but spaces is not a paragraph she meant to add. It
    // is what three blank lines in a row produce, and a block of empty
    // paragraphs is refused by validatePosts at the write boundary -- so
    // keeping them would turn one paste into a post she cannot publish, with
    // the reason attached to blocks she never knowingly created.
    .filter((chunk) => chunk.length > 0);
}
