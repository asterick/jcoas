JCOAS
=====
JCOAS is a node.js based assembler for the DCPU-16.  The ultimate goal is to provide as 
possible, in a friendly environment, without compromising on code size or speed. 

Features
--------
* Agressive short constant discovery
* Complex expression breakdown
* Local defines and scoping using the .proc directive
* Advanced macroing
* Numerous methods of handling binary data files in various formats and packing styles
* UTF-8 Compliant

Basic Setup
-----------
1. Install [Node.JS](http://nodejs.org)
2. Fetch dependancies:  `npm install` in the root directory

Running JCOAS
-------------
Currently JCOAS only provides you with a few options:

1. An ordered list of assembly files (They will be concatinated to one another)
2. Disabling / Enabling complex expression breakdown
3. Specifying a Big-Endian binary (NOTCH order)

Example:  `node jcoas.js -x main.asm secondary.asm`

Assembler Syntax
----------------
**NOTE: JCOAS is neither case, nor whitespace sensitive**

JCOAS attempts for follow notch style syntax with a few notable exceptions

1. All assembler directives are written with a dot sigil  (".dat")
2. Labels may place the ":" after as well as before an instruction
3. Completely different set of assembler directives
4. "MOV" is an alias for "SET" (Short hand)
5. Complex expressions are permitted
6. Comments may use C-style (// ... \n, /* ... */), or DASM style (; ... \n)

**EXAMPLE**
    .org 0x1000 ; Code should be relative to 0x1000, does not include actual code

    .macro BRA a
        SET PC, &a
    .end

    reset:      MOV SP, 0   ; Reset our stack pointer
                IAS &reset  ; Set interrupt service address to reset
    halt:       BRA halt    ; Lets branch forever
            
    heapSpace: .bss 0x1000  ;Allocate 4k heap space

Directives
----------

##Substituion
These are macro / replacement style directives

* .equ <name> <expression>
* .macro <name> ... .end

##Inclusion
These operate on your filesystem to include additional filesfiles

* .include
* .incbytes
* .incbig
* .inglittle

##Flow Control

* .org
* .bss
* .align
* .proc

Expressions
-----------
**NOTE: Stack, PC and EX registers may NOT be referenced in complex expressions**
**NOTE: & is currently not implemented, it is treated as a NOP**

TODO

Things Left Todo
-----------------
* Capture PEG parser errors and produce more friendly warnings
* Do shifter optimizations when possible (MUL A, 2 -> SHL A, 1)
* Better assembler error output
* Implement the relative offset (&) operator
* Implement more output formats
