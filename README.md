#JCOAS
JCOAS is a node.js based assembler for the DCPU-16.  The ultimate goal is to provide as 
possible, in a friendly environment, without compromising on code size or speed. 

##Features
* Agressive short constant discovery
* Complex expression breakdown
* Local defines and scoping using the .proc directive
* Advanced macroing
* Numerous methods of handling binary data files in various formats and packing styles
* UTF-8 Compliant

##Basic Setup
1. Install [Node.JS](http://nodejs.org)
2. Fetch dependancies:  `npm install` in the root directory

##Running JCOAS
Currently JCOAS only provides you with a few options:

1. An ordered list of assembly files (They will be concatinated to one another)
2. Disabling / Enabling complex expression breakdown
3. Specifying an output file and format (defaults to source on console)
    * "b" - Big-Endian binary
    * "l" - Little-Endian binary
    * "s" - Source "DATA" format

Example:  `node jcoas.js -f b -o binary.bin -x main.asm secondary.asm`

##Assembler Syntax
**NOTE: JCOAS is neither case, nor whitespace sensitive**

JCOAS attempts for follow notch style syntax with a few notable exceptions

1. All assembler directives are written with a dot sigil  (".dat")
2. Labels may place the ":" after as well as before an instruction
3. Completely different set of assembler directives
4. "MOV" is an alias for "SET" (Short hand)
5. Complex expressions are permitted
6. Comments may use C-style (// ... \n, /* ... */), or DASM style (; ... \n)
7. Macros and equations are scoped in .proc blocks
8. labels prefixed with an underscore (_) are scoped in .proc blocks

###EXAMPLE
    .macro PUSH(a)
        SET PUSH, a
    .end

    isr:        RFI 0           ; No routines

    reset:      MOV SP, 0       ; Reset stack, heap
                MOV A, &heapSpace
                IAS &reset

    .proc
                MOV B, 0        ; Zero out every 10 bytes of our heap-space
    _loop:      MOV [B*10+A], 0
                ADD B, 1
                IFG B, 9
                    SET B, 0
                SET PC, &_loop
    .end

    heapSpace:  .bss 0x1000     ;Allocate 4k heap space

##Directives
Directives provide assemble time functionality to the assembler.  These are
operations that either build down into a different set of data, insert new data
or alter the flow control of the application.

<table>
    <tr>
        <th colspan=3>Substituion</th>
    </tr> 
    <tr>
        <th>.equ</tg>
        <td>&lt;name&gt; &lt;value&gt;</td>
        <td>Create constant replacement</td>
    </tr>
    <tr>
        <th>.macro</tg>
        <td>&lt;name&gt; ([&lt;arguments&gt; [, &lt;argument&gt; ...]]) ... <b>.end</b></td>
        <td>Create a block replacement directive (macro)</td>
    </tr>

    <tr>
        <th colspan=3>Inclusion</th>
    </tr> 
    <tr>
        <th>.include</tg>
        <td>&lt;filename&gt;</td>
        <td>Insert file as raw assembly</td>
    </tr>
    <tr>
        <th>.incbig</tg>
        <td>&lt;filename&gt;</td>
        <td>Insert file as .DAT block, file encoded as big-endian words</td>
    </tr>
    <tr>
        <th>.inclittle</tg>
        <td>&lt;filename&gt;</td>
        <td>Insert file as .DAT block, file encoded as little-endian words</td>
    </tr>
    <tr>
        <th>.incbytes</tg>
        <td>&lt;filename&gt;</td>
        <td>Insert file as .DAT block, file encoded as bytes</td>
    </tr>

    <tr>
        <th colspan=3>Flow control</th>
    </tr> 
    <tr>
        <th>.org</tg>
        <td>&lt;location&gt;</td>
        <td>Set baseline for code positions</td>
    </tr>
    <tr>
        <th>.align</tg>
        <td>&lt;bias&gt;</td>
        <td>Align next value to an N*size word boundary</td>
    </tr>
    <tr>
        <th>.bss</tg>
        <td>&lt;size&gt;</td>
        <td>Allocate a zero fill block</td>
    </tr>
    <tr>
        <th>.data</tg>
        <td>data [, data ...]</td>
        <td>Insert raw word data</td>
    </tr>
    <tr>
        <th>.proc</tg>
        <td>... <b>.end</b></td>
        <td>Create a proceedure block scope for labels, EQUs and MACROs</td>
    </tr>
</table>

##Expressions
At the heart of the assembler is a strong, flexible expression system.  In addition
to being able to resolve assemble-time expressions, the assembler can also break down
complex, run time expressions into zero-impact instructions.  This feature should be
used sparingly, as it produces code that is entirely stack based and potentially very
large in size, very quickly.  It does not make any attempts to use registers with the
exception of indirect addressing modes.

in addition to this restriction, there are a few caveats to complex expressions:

1. You maynot use Stack, PC or EX inside of these expressions, and their values are meaningless
2. If you use indirect addressing and complex expressions, you must leave one register for each argument using indirect addressing

As a rule of thumb, the expression builder will use
* One insructions per non-compile time operation
* Two instructions per indirect address
* Two instructions per register preserve/restore

<table>
    <tr>
        <th colspan="3">Binary Operations</th>
    </tr>
    <tr>
        <th>Operation</th>
        <th>Priority</th>
        <th>Description</th>
    </tr>
    <tr>
        <th>+</th>
        <td>5</td>
        <td>Add</td>
    </tr>
    <tr>
        <th>-</th>
        <td>5</td>
        <td>Subtract</td>
    </tr>
    <tr>
        <th>/</th>
        <td>6</td>
        <td>Divide</td>
    </tr>
    <tr>
        <th>*</th>
        <td>6</td>
        <td>Multiply</td>
    </tr>
    <tr>
        <th>%</th>
        <td>6</td>
        <td>Modulo</td>
    </tr>
    <tr>
        <th>&gt;&gt;&gt;</th>
        <td>3</td>
        <td>Arithmatic bit-shift left</td>
    </tr>
    <tr>
        <th>&gt;&gt;</th>
        <td>3</td>
        <td>Bit-shift left</td>
    </tr>
    <tr>
        <th>&lt;&lt;</th>
        <td>3</td>
        <td>Bit-shift right</td>
    </tr>
    <tr>
        <th>||</th>
        <td>2</td>
        <td>Logical or</td>
    </tr>
    <tr>
        <th>&amp;&amp;</th>
        <td>1</td>
        <td>Logical and</td>
    </tr>
    <tr>
        <th>^</th>
        <td>4</td>
        <td>Exclusive-OR</td>
    </tr>
    <tr>
        <th>|</th>
        <td>4</td>
        <td>Bitwise OR</td>
    </tr>
    <tr>
        <th>&amp;</th>
        <td>4</td>
        <td>Bitwise AND</td>
    </tr>
    <tr>
        <th>#</th>
        <td>4</td>
        <td>Pack two bytes into a word (little-endian)</td>
    </tr>
    <tr>
        <th colspan="3">Unary Operations</th>
    </tr>
    <tr>
        <th colspan=2>-</th>
        <td>Bitwise OR</td>
    </tr>
    <tr>
        <th colspan=2>~</th>
        <td>Complement</td>
    </tr>
    <tr>
        <th colspan=2>&amp;</th>
        <td>Address-relative operation (relocatable) <b>NOT CURRENTLY IMPLEMENTED, TREATED AS NOP</b></td>
    </tr>
</table>

###Example
    MOV [C*9], [B*100+A]


##Things Left Todo
* Capture PEG parser errors and produce more friendly warnings
* Better assembler error output
* Do shifter optimizations when possible (MUL A, 2 -> SHL A, 1)
* Implement the relative offset (&) operator
