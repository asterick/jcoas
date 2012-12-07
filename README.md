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
3. Specifying a Big-Endian binary (NOTCH order)

Example:  `node jcoas.js -x main.asm secondary.asm`

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
    .org 0x1000 ; Code should be relative to 0x1000, does not include actual code

    .macro BRA a
        SET PC, &a
    .end

    reset:      MOV SP, 0   ; Reset our stack pointer
                IAS &reset  ; Set interrupt service address to reset
    halt:       BRA halt    ; Lets branch forever
            
    heapSpace: .bss 0x1000  ;Allocate 4k heap space

##Directives

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
      <td>&lt;name&gt; &lt;argument&gt; [, &lt;argument&gt; ...] ... <b>.end</b></td>
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
**NOTE: Stack, PC and EX registers may NOT be referenced in complex expressions**
**NOTE: & is currently not implemented, it is treated as a NOP**

TODO

##Things Left Todo
* Capture PEG parser errors and produce more friendly warnings
* Do shifter optimizations when possible (MUL A, 2 -> SHL A, 1)
* Better assembler error output
* Implement the relative offset (&) operator
* Implement more output formats
