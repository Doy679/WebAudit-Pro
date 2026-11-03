import type { PageSnapshot, RawIssue, Tokens } from "../types.js";
import { makeIssue, elementorHint } from "./issue.js";

// Frequent English misspellings (subset of Wikipedia's "Lists of common misspellings"),
// plus a few mortgage/real-estate terms. Matches are only ever "needs review".
const MISSPELLINGS: Record<string, string> = {
  recieve: "receive", recieved: "received", reciept: "receipt", acheive: "achieve", accomodate: "accommodate",
  accomodation: "accommodation", adress: "address", agressive: "aggressive", apparantly: "apparently", appearence: "appearance",
  arguement: "argument", basicly: "basically", begining: "beginning", beleive: "believe", belive: "believe",
  buisness: "business", calender: "calendar", catagory: "category", cemetary: "cemetery", collegue: "colleague",
  comming: "coming", commited: "committed", completly: "completely", concious: "conscious", definately: "definitely",
  definitly: "definitely", dissapoint: "disappoint", embarass: "embarrass", enviroment: "environment", existance: "existence",
  experiance: "experience", familar: "familiar", finaly: "finally", foriegn: "foreign", fourty: "forty",
  freind: "friend", goverment: "government", gaurantee: "guarantee", garantee: "guarantee", happend: "happened",
  harrass: "harass", immediatly: "immediately", independant: "independent", knowlege: "knowledge", liason: "liaison",
  libary: "library", lisence: "license", maintainance: "maintenance", millenium: "millennium", neccessary: "necessary",
  necesary: "necessary", noticable: "noticeable", occassion: "occasion", occured: "occurred", occurence: "occurrence",
  ocurred: "occurred", oppurtunity: "opportunity", posession: "possession", prefered: "preferred", privelege: "privilege",
  profesional: "professional", publically: "publicly", recomend: "recommend", reccomend: "recommend", refered: "referred",
  relevent: "relevant", religous: "religious", remeber: "remember", repitition: "repetition", resistence: "resistance",
  responsability: "responsibility", seperate: "separate", seperately: "separately", sucess: "success", succesful: "successful",
  successfull: "successful", supercede: "supersede", suprise: "surprise", tommorow: "tomorrow", tounge: "tongue",
  truely: "truly", untill: "until", wierd: "weird", wich: "which", writting: "writing",
  morgage: "mortgage", mortage: "mortgage", morgtage: "mortgage", refinanace: "refinance", refinace: "refinance",
  downpayment: "down payment", intrest: "interest", loanofficer: "loan officer",
  apraisal: "appraisal", appraisel: "appraisal", closeing: "closing", escro: "escrow", eligable: "eligible",
};

const PLACEHOLDER = /\b(lorem ipsum|dolor sit amet|placeholder text|your text here|sample text|insert (?:text|content) here|TBD|coming soon\.{0,3}$)/i;
const WORD = /[A-Za-z][A-Za-z'-]{2,}/g;

/** Broken images, empty headings, leftover placeholder text, suspected misspellings, overlapping text. */
export function contentChecks(page: PageSnapshot, _tokens: Tokens): RawIssue[] {
  const issues: RawIssue[] = [];

  for (const e of page.elements) {
    if (e.role === "image" && e.broken) {
      issues.push(makeIssue(page, {
        type: "content", rule: "broken-image", kind: "confirmed", severity: "high", confidence: 0.9,
        title: "Image fails to load",
        current: `src: ${e.src ?? "(empty)"}`,
        proposed: "a working image URL (or remove the image)",
        recommendation: "Re-upload the image or fix its URL." + elementorHint(e, "Content → Image"),
        element: e,
      }));
    }

    const text = (e.text ?? "").trim();
    if (e.role === "heading" && !text) {
      issues.push(makeIssue(page, {
        type: "content", rule: "empty-heading", kind: "confirmed", severity: "low", confidence: 0.85,
        title: "Empty heading",
        current: `<${e.tag}> with no text`,
        proposed: "remove it, or add heading text",
        recommendation: "Empty headings confuse screen readers and break the outline. Delete the widget or add text." + elementorHint(e, "Content → Title"),
        element: e,
      }));
    }

    if (!text || (e.role !== "text" && e.role !== "heading" && e.role !== "button" && e.role !== "link")) continue;

    const ph = text.match(PLACEHOLDER);
    if (ph) {
      issues.push(makeIssue(page, {
        type: "content", rule: "placeholder-text", kind: "confirmed", severity: "high", confidence: 0.85,
        title: "Placeholder text left on the page",
        current: `"${text.slice(0, 80)}"`,
        proposed: "final copy",
        recommendation: `Replace the placeholder ("${ph[0]}") with real content.` + elementorHint(e, "Content → Text"),
        element: e,
      }));
    }

    const found = [...new Set((text.match(WORD) ?? []).map((w) => w.toLowerCase()).filter((w) => MISSPELLINGS[w]))];
    if (found.length) {
      issues.push(makeIssue(page, {
        type: "content", rule: "suspected-misspelling", kind: "needs-review", severity: "low", confidence: 0.6,
        title: "Possible spelling mistake",
        current: found.map((w) => `"${w}"`).join(", ") + ` in "${text.slice(0, 80)}"`,
        proposed: found.map((w) => `"${MISSPELLINGS[w]}"`).join(", "),
        recommendation: "Check the spelling. Names and brand terms can trigger false matches." + elementorHint(e, "Content → Text"),
        element: e,
      }));
    }

    if (e.overlaps) {
      issues.push(makeIssue(page, {
        type: "layout", rule: "overlapping-content", kind: "needs-review", severity: "medium", confidence: 0.55,
        title: "Text overlaps another element",
        current: `overlaps ${e.overlaps}`,
        proposed: "no overlap at this viewport",
        recommendation: "Check this viewport: overlapping text is usually a positioning or negative-margin problem. Intentional overlays can be dismissed." + elementorHint(e, "Advanced → Position / Margin"),
        element: e,
      }));
    }
  }
  return issues;
}
