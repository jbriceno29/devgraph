/**
 * Plan REP, R4: the questions of a project whose repository already has code. The product exists, so they are about
 * the next milestone; its vision is inferred from the README (an inference of area VISION) for the user to correct.
 */
export const BROWNFIELD_QUESTIONS = `This project has no plan yet, but its repository ALREADY HAS CODE (see the scan below): the product exists, so do NOT ask who uses it, which problem it solves or which platform it runs on. Infer that instead: return ONE inference of area VISION whose statement says in one or two sentences what the product is, for whom and what it already does, with the README or the manifest as evidence (the user will correct it). Then ask AT MOST 5 short questions about the NEXT MILESTONE only:
- what the user wants to achieve now (for example a new feature, finishing something half done, technical debt or a migration), unless the brief already says it;
- what must NOT be touched (files, modules, public interfaces, data or behaviour that must stay as they are);
- when this milestone counts as done (a concrete, checkable outcome);
- only when the brief leaves it open: what stays out of this milestone.
Skip whatever the brief already answers; ask fewer questions when it is clear.`;
