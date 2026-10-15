/*! PS Zone Attestation · tests/markdown-cases.cjs — the inline markdown subset, as cases */
/*
 * What prose() turns an author string into:
 *   [name, input, expected HTML]            prose(input)
 *   [name, input, expected HTML, held]      prose(input, held)
 * The subset (docs/03-config.md, "Formatting"): [text](url), **bold**,
 * *italic*, \* for a literal asterisk; everything escaped first; nothing
 * else is markup; a text over 4,000 characters is shown plain.
 *
 * held is the template contract: a template ("Area: {row:AreaName}") puts
 * each value that comes from DATA (list rows, answers, the user) in the
 * held array and leaves \u0004n\u0005 in its place (n = its index), so the
 * value is never formatted: it goes back in as escaped text after the
 * author's markdown is rendered. Inside a link address the finished
 * address (values in) must still pass the address rule, or the link stays
 * as typed. A port must keep this contract, not just the plain cases.
 *
 * Written to be copied as-is to the other BSP parts that adopt the subset
 * (BSP Forms, intl.js), so they all agree on every case. Run by
 * tests/smoke.cjs against the engine's real prose().
 */
'use strict';
const A = (href, text, ext = true) =>
  '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer" data-interception="off"' : '') + '>' + text + '</a>';
const V = n => '\u0004' + n + '\u0005'; // where held value n stands
const MAX = 4000;

module.exports = [
  // the basics
  ['plain text', 'Plain text, nothing to do.', 'Plain text, nothing to do.'],
  ['bold', '**Bold**', '<strong>Bold</strong>'],
  ['italic', '*italic*', '<em>italic</em>'],
  ['mixed in a sentence', 'Any **change** is *reviewed*.', 'Any <strong>change</strong> is <em>reviewed</em>.'],
  ['two of each', '**a** **b** and *c* *d*', '<strong>a</strong> <strong>b</strong> and <em>c</em> <em>d</em>'],
  // nesting: either inside the other, both at once; crossing is never made
  ['italic inside bold', '**a *b* c**', '<strong>a <em>b</em> c</strong>'],
  ['bold inside italic', '*a **b** c*', '<em>a <strong>b</strong> c</em>'],
  ['bold and italic', '***both***', '<em><strong>both</strong></em>'],
  ['crossed markers stay entirely as typed', '*a **b* c**', '*a **b* c**'],
  ['bold holding an unpaired * stays as typed', '**a*b**', '**a*b**'],
  // asterisks that aren't emphasis stay as typed
  ['spaced arithmetic', '5 * 3 * 2', '5 * 3 * 2'],
  ['inside a word', 'a*b*c', 'a*b*c'],
  ['trailing footnote star', 'Public*', 'Public*'],
  ['unclosed bold', '**unclosed', '**unclosed'],
  ['spaced markers', '** not bold ** and * not italic *', '** not bold ** and * not italic *'],
  ['across a line break', '*a\nb*', '*a\nb*'],
  ['across a carriage return', '**a\rb**', '**a\rb**'],
  ['across a Unicode line separator', '*a\u2028b* **c\u2029d**', '*a\u2028b* **c\u2029d**'],
  ['inside an accented word', 'é*mot*é and café**s**', 'é*mot*é and café**s**'],
  ['an accented word on its own', '**é** *à*', '<strong>é</strong> <em>à</em>'],
  ['escaped asterisks', 'Zones marked \\*restricted\\* need approval.', 'Zones marked *restricted* need approval.'],
  ['escaped inside bold', '**5 \\* 3**', '<strong>5 * 3</strong>'],
  // links, and emphasis around and inside them
  ['link', 'See the [standards](https://example.com/s).', 'See the ' + A('https://example.com/s', 'standards') + '.'],
  ['server-relative link', '[list](/sites/FCUPortal/x.aspx)', A('/sites/FCUPortal/x.aspx', 'list')],
  ['anchor link (same page, no new tab)', '[top](#top)', A('#top', 'top', false)],
  ['mailto link', '[Ana](mailto:ana@example.com)', A('mailto:ana@example.com', 'Ana')],
  ['bold link text', '[**bold link**](/x)', A('/x', '<strong>bold link</strong>')],
  ['link inside bold', '**[link](#top)**', '<strong>' + A('#top', 'link', false) + '</strong>'],
  ['** inside a URL is left alone', '[x](https://example.com/a**b**c)', A('https://example.com/a**b**c', 'x')],
  ['emphasis markers between slashes in a URL are left alone', '[x](https://example.com/**b**/*c*/)', A('https://example.com/**b**/*c*/', 'x')],
  ['javascript: is never a link', '[x](javascript:alert(1))', '[x](javascript:alert(1))'],
  ['a protocol-relative address is never a link', '[x](//evil.example/)', '[x](//evil.example/)'],
  ['a slash-backslash address is never a link', '[x](/\\evil.example/)', '[x](/\\evil.example/)'],
  ['the site root is a link', '[home](/)', A('/', 'home')],
  ['italic link text', '[*x*](/a)', A('/a', '<em>x</em>')],
  ['bold and italic link text', '[***x***](/a)', A('/a', '<em><strong>x</strong></em>')],
  ['escaped asterisk in link text', '[a\\*b](/a)', A('/a', 'a*b')],
  ['bold around a link', '**see [x](/a) now**', '<strong>see ' + A('/a', 'x') + ' now</strong>'],
  ['italic around a link', '*see [x](/a)*', '<em>see ' + A('/a', 'x') + '</em>'],
  // escaping comes first: no string can make markup by itself
  ['HTML is shown, not run', '<b>x</b> **y**', '&lt;b&gt;x&lt;/b&gt; <strong>y</strong>'],
  ['HTML inside bold', '**<img src=x onerror=alert(1)>**', '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>'],
  ['quotes and ampersands', 'Q&A "today"', 'Q&amp;A &quot;today&quot;'],
  ['control characters are dropped', 'a\u0001b\u00020\u0003c', 'ab0c'],
  // block markup isn't part of the subset: it shows as typed
  ['heading', '# Heading', '# Heading'],
  ['bullet', '- item', '- item'],
  ['star bullet', '* item', '* item'],
  ['numbered', '1. First', '1. First'],
  ['divider', '---', '---'],
  // real-world text
  ['emails and underscores', 'first_last@example.com in PS_Zone-Attestation', 'first_last@example.com in PS_Zone-Attestation'],
  ['French guillemets', '« *texte* »', '« <em>texte</em> »'],
  ['French punctuation', 'Qui? *Vous*! **Merci** :', 'Qui? <em>Vous</em>! <strong>Merci</strong> :'],
  ['apostrophe before italic', "l'*outil*", "l'<em>outil</em>"],
  // the length bound: 4,000 characters still format, 4,001 show plain
  ['exactly 4,000 characters still format', '**b** ' + 'x'.repeat(MAX - 6), '<strong>b</strong> ' + 'x'.repeat(MAX - 6)],
  ['4,001 characters show plain, escaped', '**b** <i>' + 'x'.repeat(MAX - 8), '**b** &lt;i&gt;' + 'x'.repeat(MAX - 8)],
  // held values (templates): data is never formatted, the author's markdown is
  ['a held value goes in as escaped text', 'Area: ' + V(0), 'Area: **x** [a](https://example.com) &lt;b&gt;',
    ['**x** [a](https://example.com) <b>']],
  ['author markdown around a held value formats', '**' + V(0) + '** for *' + V(1) + '*', '<strong>Ana</strong> for <em>Tower 10</em>',
    ['Ana', 'Tower 10']],
  ['held values over the bound still go back in, plain', '**b** ' + 'x'.repeat(MAX) + V(0), '**b** ' + 'x'.repeat(MAX) + '&lt;v&gt;', ['<v>']],
  ['a held value in a link address: allowed when the finished address passes', '[open](/sites/' + V(0) + ')',
    A('/sites/Area-1?c=1&amp;d=&quot;q&quot;', 'open'), ['Area-1?c=1&d="q"']],
  ['a held value making "//host" leaves the link as typed', '[x](/' + V(0) + ')', '[x](//evil.example/)', ['/evil.example/']],
  ['a held value making "/\\host" leaves the link as typed', '[x](/' + V(0) + ')', '[x](/\\evil.example/)', ['\\evil.example/']],
  ['a held value adding a space leaves the link as typed', '[x](/a' + V(0) + ')', '[x](/a b)', [' b']],
  ['a held value as the whole address is never a link', '[x](' + V(0) + ')', '[x](https://example.com)', ['https://example.com']],
  ['held markers an author typed lose their control characters', 'a' + V(0) + 'b', 'a0b']
];
