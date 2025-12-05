// -----------------------------
// Basic format enums and interfaces
// -----------------------------
export enum FormatTypes {
    HEADER_1,
    HEADER_2,
    HEADER_3,
    HEADER_4,
    HEADER_5,
    HEADER_6,
    PARAGRAPH,
    BULLET,
    NUMBERED,
    TABLE,
    IMAGE,
    CODE_BLOCK,
    QUOTE,
}


export enum Fonts {
    TIMES_ROMAN,
    COURIER,
    HELVETICA,
    HELVETICA_BOLD,
    HELVETICA_ITALIC,
    HELVETICA_BOLD_ITALIC,
}


// Each content block in a document
export interface DocumentBlock {
    format: FormatTypes;
    content: string | string[]; // can be text, list items, etc. string as html / mrkdown
    metadata?: Record<string, any>; // optional extra formatting info (e.g. alignment)
}
