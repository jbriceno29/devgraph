/** The domains typed in the text area: one per line (commas and spaces also separate them). */
export const domainLines = (text: string) => text.split(/[\s,]+/).filter(Boolean);
