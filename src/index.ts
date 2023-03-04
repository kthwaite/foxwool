import { Lexer, Token } from "./lexer";

interface ASTNode {
    type: 'list' | 'literal' | 'ref' | 'expansion' | 'block' | 'document';
}

interface Literal extends ASTNode {
    type: 'literal',
    value: string,
}
type ListParts = Literal | Expansion | Ref | List;

interface List extends ASTNode {
    type: 'list',
    items: ListParts[],
}

interface Ref extends ASTNode {
    type: 'ref',
    value: string,
}

type StringParts = Literal | Ref | List;
interface Expansion extends ASTNode {
    type: 'expansion',
    parts: StringParts[],
}

interface Block extends ASTNode {
    type: 'block',
    header: string,
    body: List | Expansion,
}

interface Document extends ASTNode {
    type: 'document',
    blocks: Block[]
}

class ParserError extends Error { }

/** Error thrown when the parser encounters an unexpected EOF. */
class UnexpectedEOF extends ParserError {
    msg: string;
    line: string;
    token: Token;
    constructor(token: Token, line: string) {
        const { lineno, beg } = token;
        const msg = `Unexpected EOF @ ${lineno}:${beg}`;
        super(msg);
        this.msg = msg;
        this.line = line;
        this.token = token;
    }
    describe() {
        return this.msg;
    }
}

/** Error thrown when the parser encounters an unexpected token. */
class UnexpectedTokenError extends ParserError {
    msg: string;
    expected?: string;
    line: string;
    token: Token;
    constructor(token: Token, line: string, expected?: string, origin?: string) {
        const { lineno, beg } = token;
        const msg = expected ? `Expected ${expected}, got ${token.type} @ ${lineno}:${beg}` : `Got unexpected token ${token.type} @ ${lineno}:${beg}`;
        super(msg);
        this.msg = msg;
        this.expected = expected;
        this.token = token;
        this.line = line;
    }
    describe(): string {
        const { beg, end } = this.token;
        const pad = ' '.repeat(beg);
        const expr = `~`.repeat(end - beg + 1);
        return (
            this.msg
            + `\n${this.line}`
            + `\n${pad}\x1b[31m${expr}\x1b[0m`
        );
    }
}

/** Parser, consuming tokens and producing an AST. */
class Parser {
    lexer: Lexer;
    token: Token;
    lookahead: Token;

    /** Create a new parser. */
    constructor(lexer: Lexer) {
        this.lexer = lexer;
        this.token = lexer.nextToken();
        this.lookahead = lexer.nextToken();
    }

    /** Get the next token. */
    nextToken() {
        this.token = this.lookahead;
        this.lookahead = this.lexer.nextToken();
    }

    /** Advance to the next non-newline token. */
    advanceNewline() {
        while (this.token.type === 'NEWLINE') {
            this.nextToken();
        }
    }

    /** Expect a token of a given type. */
    expect(type: string, advance: boolean = true) {
        if (this.token.type !== type) {
            const { lineno, beg } = this.token;
            throw new UnexpectedTokenError(this.token, this.lexer.getLine(this.token.lineno), type);
        }
        if (advance) {
            this.nextToken();
        }
    }

    /** Create a new UnexpectedTokenError. */
    unexpected(): UnexpectedTokenError {
        return new UnexpectedTokenError(this.token, this.lexer.getLine(this.token.lineno));
    }

    /** Check if the current token is EOF. */
    eof() {
        return this.token.type == 'EOF';
    }

    parseExpansion(): Expansion {
        let parts: StringParts[] = [];
        while (!this.eof()) {
            switch (this.token.type) {
                case 'QUOTE_R':
                    this.nextToken();
                    return { type: 'expansion', parts };
                case 'STRING':
                    if (this.token.content == null) {
                        throw new Error();
                    }
                    parts.push({ type: 'literal', value: this.token.content });
                    break;
                case 'HASH':
                    break;
                case 'IDENT':
                    if (this.token.content == null) {
                        throw new Error();
                    }
                    parts.push({ type: 'ref', value: this.token.content });
                    break;
                case 'SQBRACE_L':
                    parts.push(this.parseList());
                    break;
                default:
                    throw this.unexpected();
            }
            this.nextToken();
        }
        throw new UnexpectedEOF(this.token, this.lexer.getLine(this.token.lineno));
    }

    parseList(): List {
        let items: ListParts[] = [];
        while (!this.eof()) {
            switch (this.token.type) {
                case 'QUOTE_L':
                    this.nextToken();
                    items.push(this.parseExpansion());
                    continue;
                case 'SQBRACE_R':
                    this.nextToken();
                    return { type: 'list', items };
                case 'COMMA':
                    break;
                case 'NEWLINE':
                    break;
                case 'STRING':
                    if (this.token.content == null) {
                        throw new Error();
                    }
                    items.push({ type: 'literal', value: this.token.content.trim() });
                    break;
                default:
                    throw this.unexpected();
            }
            this.nextToken();
        }
        throw new UnexpectedEOF(this.token, this.lexer.getLine(this.token.lineno));
    }

    parseBody(): List | Expansion {
        switch (this.token.type) {
            case 'QUOTE_L':
                this.nextToken();
                return this.parseExpansion();
            case 'SQBRACE_L':
                this.nextToken();
                return this.parseList();
            default:
                throw this.unexpected();
        }
    }

    parseBlock(): Block {
        this.expect('HEAD');
        this.expect('IDENT', false);
        const header = this.token.content == null ? '' : this.token.content;
        this.nextToken();
        this.advanceNewline();
        return {
            type: 'block',
            header,
            body: this.parseBody()
        };
    }

    parseDocument(): Document {
        let blocks = [];
        while (!this.eof()) {
            const block = this.parseBlock();
            blocks.push(block);
            this.advanceNewline();
        }
        return { type: 'document', blocks };
    }

    parse(): Document {
        while (this.token.type === 'NEWLINE') {
            this.nextToken();
        }
        return this.parseDocument();
    }
}



interface LexiconStore {
    [key: string]: any,
}

class Lexicon {
    store: LexiconStore;
    constructor(store: LexiconStore) {
        this.store = store;
    }

    // TODO: FragmentParser for arbitrary exprs
    resolve(s: string): string {
        let stack: any[] = [
            [0, this.store[s]],
        ];
        let output: string[]= [];

        while (stack.length > 0) {
            let [index, ref] = stack.pop();
            while (index < ref.length) {
                const item = ref[index];
                switch (item.type) {
                    case 'literal':
                    case 'string':
                        output.push(item.value);
                        break;
                    case 'list':
                        const len = item.value.length;
                        const value = item.value[Math.floor(Math.random() * len)];
                        switch (value.type) {
                            case 'literal':
                                output.push(value.value);
                                break;
                            case 'expansion':
                                stack.push([index + 1, ref]);
                                index = -1;
                                ref = value.parts;
                                break;
                            default:
                                throw new Error(`Unhandled value: ${value.type}`);
                        }
                        break;
                    case 'ref':
                        stack.push([index + 1, ref]);
                        index = -1;
                        ref = this.store[item.value];
                        if (ref == null) {
                            throw new Error(`Null ref for '${item.value}'`)
                        }
                        break;
                    default:
                        // TODO: throw error here
                        break;
                }
                index += 1;
            }
        }
        return output.join("");
    }
}

function compileExpansion(e: Expansion): CompiledExpansion[] {
    let onlyString = true;
    for (let item of e.parts) {
        if (typeof item !== 'string') {
            onlyString = false;
            break;
        }
    }
    if (onlyString) {
        return [{ type: 'string', value: e.parts.join("") }];
    }
    let parts: CompiledExpansion[] = [];
    for (let item of e.parts) {
        switch (item.type) {
            case 'ref':
                parts.push({ type: 'ref', value: item.value });
                break;
            case 'list':
                parts.push({ type: 'list', value: item.items });
                break;
            case 'literal':
                parts.push({ type: 'string', value: item.value });
                break;
            default:
                break;
        }
    }
    return parts;
}

interface CompiledExpansion {
    type: 'string' | 'ref' | 'list';
    value: string | ListParts | ListParts[];
}

/** Compile a Document into a Lexicon */
function compile(d: Document): Lexicon {
    const out: LexiconStore = {};
    for (let block of d.blocks) {
        const { header, body } = block;
        let impl: CompiledExpansion[];
        switch (body.type) {
            case 'expansion':
                impl = compileExpansion(body);
                break;
            case 'list':
                // TODO: simplify if only one item
                impl = [{ type: 'list', value: body.items }];
                break;
            default:
                throw new Error(`Failed to compile: ${body}`);
        }
        out[header] = impl;
    }
    return new Lexicon(out);
}
const input = `
* place
[
    an agony of imagination,
    the harsh darwinian process,
    my bed,
    the racecourse,
    my lawn,
    the boiling air,
    the ceiling,
    the foundations,
    the rotting roofbeams,
]
* animals
[ bears, flies, sheep, goats, ants, horses, birds, dogs, centipedes,
    gazelles,
    gemsbocks,
    eels

]

* pverb
[ tottered, limped, puffed up, crinkled ]

* verb
[ cauterize, eat run, jump, butcher, scream, throw, lift, antagonize, harass, yell ]

* thing
[
    a warped map,
    scab hillocks,
    floorboards,
    the boiling air,
    peppery dust,
    sand,
    ochre bars,
    divots of gristle,
    feathers,
    sun-dried lawn,
]

* vision
[
    "#animals #verb as they #verb",
    "#animals that now #verb without #thing",
    "#thing fountained to #place",
    "#pverb through #place",
    "whose #thing lies in #place",
    "i #pverb in #thing of #place",
    "#thing filmed over with #thing",
    "making #thing",
    "dabbing at #thing",
    "i shovel #thing into #place",
]

* action
[
    "i lay in #place",
    "i #verb at the #animals",
    "the #animals expose their #pverb #thing"
]

* line
[ "#vision", "#vision", "#vision", "#action" ]

* poem
"#line
#line
#line
#line"
`;
let doc: Document;
const par0 = performance.now();
let lex = new Lexer(input);
try {
    let par = new Parser(lex);
    doc = par.parse();
} catch (err) {
    console.error(err.describe());
    throw err;
}
const par1 = performance.now();
if (doc == null) {
    throw new Error();
}
const c0 = performance.now();
const com = compile(doc);
const c1 = performance.now();
const per0 = performance.now();
const out = com.resolve('poem');
const per1 = performance.now();
console.log(out);
console.log('---')
console.log(`parse: ${par1 - par0}ms | compile ${c1 - c0}ms | perform ${per1 - per0}ms`)
