/**
 * Staff names never leave the server: the AI sees "Person 1", "Person 2",
 * and the real names are put back into its answer. The free Gemini tier may
 * use what it's sent to improve Google's products, so this matters.
 */
export class NameMasker {
  private readonly aliasByName = new Map<string, string>();

  mask(name: string): string {
    let alias = this.aliasByName.get(name);
    if (!alias) {
      alias = `Person ${this.aliasByName.size + 1}`;
      this.aliasByName.set(name, alias);
    }
    return alias;
  }

  /** Replace every name already masked wherever it appears in free text, e.g. "Sale #4 by Ana". */
  maskKnown(text: string): string {
    const pairs = [...this.aliasByName].sort(([a], [b]) => b.length - a.length);
    return pairs.reduce((result, [name, alias]) => result.split(name).join(alias), text);
  }

  unmask(text: string): string {
    // Longest alias first, so "Person 12" isn't read as "Person 1" + "2".
    const pairs = [...this.aliasByName].sort(([, a], [, b]) => b.length - a.length);
    return pairs.reduce((result, [name, alias]) => result.replace(new RegExp(`\\b${alias}\\b`, 'g'), () => name), text);
  }
}
