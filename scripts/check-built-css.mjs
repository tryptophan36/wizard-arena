import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const staticDirectory = join(process.cwd(), ".next", "static");

function findCssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findCssFiles(path);
    return entry.name.endsWith(".css") && statSync(path).isFile() ? [path] : [];
  });
}

const cssFiles = findCssFiles(staticDirectory);
const builtCss = cssFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const requiredSpellbookSelectors = [
  "spellbook-reader-page",
  "spellbook-book",
  "spellbook-page-navigation",
];
const missingSelectors = requiredSpellbookSelectors.filter((selector) => !builtCss.includes(selector));

if (missingSelectors.length > 0) {
  throw new Error(`Built CSS is missing spellbook selectors: ${missingSelectors.join(", ")}`);
}

console.log(`Built CSS contains the spellbook reader styles (${cssFiles.length} stylesheet${cssFiles.length === 1 ? "" : "s"}).`);
