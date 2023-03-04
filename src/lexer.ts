/*
 * root = block*
 * block = header body
 * header = "*" WORD (" " WORD)+
 * body = (list | assign | string)+
 * list = "[" listitem ("," listitem)* "]"
 * listitem = WORD | string
 * string = "\"" (var | expan | WORD | PUNCT | " " | "\n") "\""
 * var = "$" ident
 * expan = "#" ident
 * ident = WORD
 * WORD = /a-zA-Z0-9_-/+
 * PUNCT = /[,.?!]/ | "\\\""
 */

const isValidIdent = new RegExp(/[a-zA-Z0-9-_]/);
const isValidIdentInitial = new RegExp(/[a-zA-Z]/);

/** A token returned by the lexer. */
export interface Token {
    type: string,
    content?: string,
    lineno: number,
    beg: number,
    end: number,
}

/** Lexer, consuming a string and producing tokens. */
export class Lexer {
    /** The input string. */
    content: string;
    /** The left-hand side of the current token. */
    lhs: number;
    /** The right-hand side of the current token. */
    rhs: number;
    /** Current character. */
    ch: string;
    /** The beginning of the current line, as an offset into the input string. */
    linebeg: number;
    /** Current line number. */
    lineno: number;
    /** Offsets into the input string for each line. */
    lineoff: number[];
    /** The current state of the lexer. */
    _state: string[];

    /** Construct a new lexer from the given input string. */
    constructor(s: string) {
        this.content = s;
        this.lhs = 0;
        this.rhs = 0;
        this.linebeg = 0;
        this.lineoff = [0];
        this.lineno = 0;
        this.ch = "";
        this._state = ["ROOT"];
        this.advance();
    }

    /** Create a token with the given type and content from the current character. */
    _simple(type: string): Token {
        return this._content(type, this.lhs, this.lhs);
    }

    /**
     * Create a token with the given type and content from a slice of the input string.
     * @param type The type of the token
     * @param lhs The left-hand side of the slice.
     * @param rhs The right-hand side of the slice.
     */
    _content(type: string, lhs: number, rhs: number) {
        return {
            type,
            content: this.content.slice(lhs, rhs),
            beg: lhs - this.linebeg,
            end: rhs - this.linebeg,
            lineno: this.lineno,
        }
    }

    /**
     * Get the line number of the current token.
     * @param lineno The line number to get.
     * @returns The line number of the current token.
     */
    getLine(lineno: number) {
        if (lineno > this.lineoff.length - 1) {
            throw new Error(`Line ${lineno} is out of range (max: ${this.lineoff.length})`);
        }
        const beg = this.lineoff[lineno];
        let end = beg;
        while (this.content[end] != '\n' && end < this.content.length) {
            ++end;
        }
        return this.content.slice(beg, end);
    }

    /** Advance the lexer to the next character, skipping whitespace. */
    advance() {
        if (this.state() == "EOF") {
            return;
        }
        if (this.rhs >= this.content.length) {
            this._state.push("EOF");
            return;
        }
        this.lhs = this.rhs;
        if (this.ch === '\n') {
            this.lineno += 1;
            this.linebeg = this.lhs;
            this.lineoff.push(this.lhs);
        }
        this.ch = this.content[this.lhs];
        this.rhs += 1;
    }

    /** Peek at the next character in the input. */
    peek() {
        if (this.rhs >= this.content.length) {
            return "";
        }
        return this.content[this.rhs];
    }

    /** Get the current state of the lexer. */
    state(): string {
        return this._state[this._state.length - 1];
    }

    /** Push a new state into the state stack. */
    pushState(s: string) {
        this._state.push(s);
    }

    /** Pop the current state from the state stack. */
    popState() {
        if (!this.eof()) {
            this._state.pop();
        }
    }

    /** Check if the lexer is at the end of the file. */
    eof(): boolean {
        return this.state() == "EOF";
    }

    /** Advance past whitespace and linebreaks. */
    advanceWhitespaceAndLinebreaks() {
        while (!this.eof()) {
            switch (this.ch) {
                case " ":
                case "\n":
                case "\r":
                case "\t":
                    break;
                default:
                    return;
            }
            this.advance();
        }
    }

    /** Advance past whitespace. */
    advanceWhitespace() {
        while (!this.eof()) {
            switch (this.ch) {
                case " ":
                case "\t":
                    break;
                default:
                    return;
            }
            this.advance();
        }
    }

    handleNewline(): Token {
        switch (this.ch) {
            case '*':
                let tok = this._simple("HEAD")
                this.advance();
                return tok;
            default:
                this.popState();
                return this.handleRoot();
        }
    }

    handleIdent() {
        if (!isValidIdentInitial.test(this.ch)) {
            throw new Error(`Invalid identifier ${this.ch}`);
        }
        let lhs = this.lhs;
        while (!this.eof()) {
            if (!isValidIdent.test(this.ch)) {
                this.popState();
                return this._content('IDENT', lhs, this.lhs);
            }
            this.advance();
        }
        throw new Error("Unexpected EOF");
    }

    /** Parse a list. */
    handleList() {
        // advance to the first non-whitespace token
        this.advanceWhitespaceAndLinebreaks();
        if (this.eof()) {
            return this._simple("EOF");
        }
        const lhs = this.lhs;
        switch (this.ch) {
            // these can only ever be the first token encountered
            case '[':
                this.pushState('LIST');
                this.advance();
                return this._simple("SQBRACE_L");
            case '"':
                this.advance();
                this.pushState('STRING');
                return this._simple("QUOTE_L");
            case ',':
                this.advance();
                return this._simple("COMMA");
            case ']':
                this.popState();
                this.advance();
                return this._simple("SQBRACE_R");
            // this is a 'naked' string
            default: {
                while (!this.eof()) {
                    switch (this.ch) {
                        case ',':
                        case ']':
                        case '"':
                        case '[':
                            return this._content('STRING', lhs, this.lhs);
                        default:
                            break;
                    }
                    this.advance();
                }
                throw new Error("Unexpected EOF");
            }
        }
    }

    /** Parse a string. */
    handleString() {
        let lhs = this.lhs;
        while (!this.eof()) {
            switch (this.ch) {
                case '"':
                    if (lhs == this.lhs) {
                        this.advance();
                        this.popState();
                        return this._simple("QUOTE_R");
                    }
                    return this._content('STRING', lhs, this.lhs);
                case '#':
                    if (lhs == this.lhs) {
                        this.advance();
                        this.pushState('IDENT');
                        return this._simple("HASH");
                    }
                    return this._content('STRING', lhs, this.lhs);
                case '[':
                    if (lhs == this.lhs) {
                        this.advance();
                        this.pushState('LIST');
                        return this._simple("SQBRACE_L");
                    }
                    return this._content('STRING', lhs, this.lhs);
                default:
                    break;
            }
            this.advance();
        }
        throw new Error("Unexpected EOF");
    }

    handleRoot() {
        this.advanceWhitespace();
        if (this.eof()) {
            return this._simple("EOF");
        }
        let tok: Token;
        switch (this.ch) {
            case "\n":
                tok = this._simple('NEWLINE');
                this.advance();
                this.pushState('NEWLINE');
                return tok;
            case '"':
                tok = this._simple('QUOTE_L');
                this.advance();
                this.pushState('STRING');
                return tok;
            case '[':
                tok = this._simple('SQBRACE_L');
                this.advance();
                this.pushState('LIST');
                return tok;
            case '#':
                tok = this._simple('HASH');
                this.advance();
                this.pushState('IDENT');
                return tok;
            case '*':
                tok = this._simple("HEAD");
                this.advance();
                return tok;
            default:
                this.pushState('IDENT');
                return this.handleIdent();
        }
    }

    /** Get the next token. */
    nextToken(): Token {
        switch (this.state()) {
            case "ROOT":
                return this.handleRoot();
            case 'NEWLINE':
                return this.handleNewline();
            case 'STRING':
                return this.handleString();
            case 'IDENT':
                return this.handleIdent();
            case 'LIST':
                return this.handleList();
            case "EOF":
                return this._simple('EOF');
            default:
                throw new Error(`Unhandled state: ${this.state()}`);
        }
    }
}
