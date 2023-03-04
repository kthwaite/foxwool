use std::{iter::Peekable, str::Chars};
use thiserror::Error;

#[derive(Debug, PartialEq)]
pub enum Token {
    Expan,
    Module,
    Ident(String),
    Quoted(String),
    LBrace,
    RBrace,
    LSquare,
    RSquare,
    LParen,
    RParen,
    Comma,
    Body(String),
    EOF,
    Unknown(char),
}

impl Token {
    pub fn ident(s: &str) -> Token {
        match s {
            "expan" => Token::Expan,
            "mod" => Token::Module,
            _ => Token::Ident(s.to_string()),
        }
    }
    pub fn quoted(s: &str) -> Token {
        Token::Quoted(s.to_string())
    }
    pub fn body(s: &str) -> Token {
        Token::Body(s.to_string())
    }
}

#[derive(Error, Debug)]
pub enum LexError {
    #[error("No matches")]
    NoMatches,
}

/// Consumes bytes while a predicate evaluates to true.
fn take_while<F>(data: &str, mut pred: F) -> Result<(&str, usize), LexError>
where
    F: FnMut(char) -> bool,
{
    let mut current_index = 0;

    for ch in data.chars() {
        let should_continue = pred(ch);

        if !should_continue {
            break;
        }

        current_index += ch.len_utf8();
    }

    if current_index == 0 {
        Err(LexError::NoMatches)
    } else {
        Ok((&data[..current_index], current_index))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LexerState {
    Outer,
    ExpanList,
    QuotedString,
}

struct Lexer<'a> {
    input: &'a str,
    position: usize,
    read_position: usize,
    iterator: Peekable<Chars<'a>>,
    ch: Option<char>,
    state: Vec<LexerState>,
}

impl<'a> Lexer<'a> {
    pub fn new(input: &'a str) -> Self {
        let iterator = input.chars().peekable();
        let mut lexer = Lexer {
            input,
            position: 0,
            read_position: 0,
            ch: None,
            iterator,
            state: vec![LexerState::Outer],
        };
        lexer.read_char();
        lexer
    }
    /// Advance past whitespace.
    pub fn advance_whitespace(&mut self) {
        while let Some(ch) = self.ch {
            if !ch.is_whitespace() {
                break;
            }
            self.read_char();
        }
    }
    /// Read a character and advance the read position.
    fn read_char(&mut self) {
        if self.read_position >= self.input.len() {
            self.ch = None;
        } else {
            self.ch = self.iterator.next();
        }
        self.position = self.read_position;
        self.read_position += 1;
    }

    fn read_string(&mut self) -> Token {
        self.read_char();
        let lhs = self.position;
        loop {
            match self.ch {
                Some('"') | None => break,
                _ => (),
            }
            self.read_char();
        }
        Token::quoted(&self.input[lhs..self.position])
    }

    fn read_identifier(&mut self) -> Token {
        let position = self.position;
        while let Some(ch) = self.ch {
            if ch.is_alphabetic() || ch == '_' {
                self.read_char();
            } else {
                break;
            }
        }

        Token::ident(&self.input[position..self.position])
    }

    pub fn next_token(&mut self) -> Token {
        self.advance_whitespace();
        let tok = match self.ch {
            Some(',') => Token::Comma,
            Some('(') => Token::LParen,
            Some(')') => Token::RParen,
            Some('{') => Token::LBrace,
            Some('}') => Token::RBrace,
            Some('[') => Token::LSquare,
            Some(']') => Token::RSquare,
            Some('"') => self.read_string(),
            Some(_) => self.read_identifier(),
            None => Token::EOF,
        };
        self.read_char();
        tok
    }
}

fn main() {
    let stmt = r#"
    expan foo [
        "This is the body of the expansion."
    ]
    expan name [
        jerry,
        harry,
        dave,
    ]
    expan bar [
        "Foo says: #foo"
        "baz:Foo says: #baz:foo"
        " #(cap #name)"
    ]
    mod baz {
        expan foo [
            "This is the body of another expansion."
        ]
    }
    "#;
    let mut lex = Lexer::new(stmt);
    loop {
        let token = lex.next_token();
        if token == Token::EOF {
            break;
        }
        println!("{:?}", token);
    }
}
