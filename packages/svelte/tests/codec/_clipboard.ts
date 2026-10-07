// What a copy out of each source app puts on the clipboard, by MIME type: the markup and
// the text each writes for a table, cut to a few rows. The spellings are the apps' own —
// Word's `MsoNormal` paragraphs and `o:p` ends, Docs' guid wrapper and per-cell `style`,
// Excel's fragment comments and classes, Sheets' origin element — since what a reader
// skips is as much the contract as what it reads.

/** Clipboard contents, keyed by MIME type. */
export type Clipboard = Record<string, string>;

/** Microsoft Word, a whole table selected: the header row bold, a cell merged down two
 *  rows and one across three, an italic word, and an empty cell, which Word writes as a
 *  paragraph holding a non-breaking space. */
export const WORD: Clipboard = {
	'text/html': `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
xmlns="http://www.w3.org/TR/REC-html40">

<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="Microsoft Word 15">
<meta name=Originator content="Microsoft Word 15">
<link rel=File-List
href="file:///C:/Users/user/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml">
<style>
<!--
 /* Style Definitions */
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{mso-style-unhide:no;
	mso-style-qformat:yes;
	margin-top:0in;
	margin-right:0in;
	margin-bottom:8.0pt;
	margin-left:0in;
	line-height:107%;
	font-size:11.0pt;
	font-family:"Calibri",sans-serif;}
table.MsoTableGrid
	{mso-style-name:"Table Grid";
	mso-tstyle-rowband-size:0;
	mso-tstyle-colband-size:0;
	border:solid windowtext 1.0pt;}
-->
</style>
</head>

<body lang=EN-US style='tab-interval:.5in;word-wrap:break-word'>
<!--StartFragment-->

<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;
 mso-yfti-tbllook:1184;mso-padding-alt:0in 5.4pt 0in 5.4pt'>
 <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
  <td width=208 valign=top style='width:155.8pt;border:solid windowtext 1.0pt;
  mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><b><span
  style='font-family:"Times New Roman",serif'>Office<o:p></o:p></span></b></p>
  </td>
  <td width=208 valign=top style='width:155.8pt;border:solid windowtext 1.0pt;
  border-left:none;mso-border-left-alt:solid windowtext .5pt;mso-border-alt:
  solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><b><span
  style='font-family:"Times New Roman",serif'>Symbol<o:p></o:p></span></b></p>
  </td>
  <td width=208 valign=top style='width:155.8pt;border:solid windowtext 1.0pt;
  border-left:none;mso-border-left-alt:solid windowtext .5pt;mso-border-alt:
  solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><b><span
  style='font-family:"Times New Roman",serif'>Phone<o:p></o:p></span></b></p>
  </td>
 </tr>
 <tr style='mso-yfti-irow:1'>
  <td width=208 rowspan=2 valign=top style='width:155.8pt;border:solid windowtext 1.0pt;
  border-top:none;mso-border-top-alt:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;
  padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'>Plans<o:p></o:p></span></p>
  </td>
  <td width=208 valign=top style='width:155.8pt;border-top:none;border-left:
  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;
  mso-border-top-alt:solid windowtext .5pt;mso-border-left-alt:solid windowtext .5pt;
  mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'>XP<o:p></o:p></span></p>
  </td>
  <td width=208 valign=top style='width:155.8pt;border-top:none;border-left:
  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;
  mso-border-top-alt:solid windowtext .5pt;mso-border-left-alt:solid windowtext .5pt;
  mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'>555-0100<o:p></o:p></span></p>
  </td>
 </tr>
 <tr style='mso-yfti-irow:2'>
  <td width=208 valign=top style='width:155.8pt;border-top:none;border-left:
  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;
  mso-border-top-alt:solid windowtext .5pt;mso-border-left-alt:solid windowtext .5pt;
  mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'>XPX<o:p></o:p></span></p>
  </td>
  <td width=208 valign=top style='width:155.8pt;border-top:none;border-left:
  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;
  mso-border-top-alt:solid windowtext .5pt;mso-border-left-alt:solid windowtext .5pt;
  mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'><o:p>&nbsp;</o:p></span></p>
  </td>
 </tr>
 <tr style='mso-yfti-irow:3;mso-yfti-lastrow:yes'>
  <td width=624 colspan=3 valign=top style='width:467.5pt;border:solid windowtext 1.0pt;
  border-top:none;mso-border-top-alt:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;
  padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span
  style='font-family:"Times New Roman",serif'>See <i>attached</i> roster<o:p></o:p></span></p>
  </td>
 </tr>
</table>

<!--EndFragment-->
</body>

</html>`
};

/** Microsoft Excel, a range of two columns: both the markup and the text. The header's
 *  bold is a class, a number's alignment an attribute, and a cell holding a line break
 *  is a `<br>` in the markup and a quoted cell in the text, whose rows end `\r\n`, the
 *  last one included. */
export const EXCEL: Clipboard = {
	'text/html': `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">

<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<link id=Main-File rel=Main-File
href="file:///C:/Users/user/AppData/Local/Temp/msohtmlclip1/01/clip.htm">
<link rel=File-List
href="file:///C:/Users/user/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml">
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
@page
	{margin:.75in .7in .75in .7in;
	mso-header-margin:.3in;
	mso-footer-margin:.3in;}
tr
	{mso-height-source:auto;}
col
	{mso-width-source:auto;}
br
	{mso-data-placement:same-cell;}
td
	{padding-top:1px;
	padding-right:1px;
	padding-left:1px;
	mso-ignore:padding;
	color:black;
	font-size:11.0pt;
	font-weight:400;
	font-style:normal;
	text-decoration:none;
	font-family:Calibri, sans-serif;
	mso-font-charset:0;
	mso-number-format:General;
	text-align:general;
	vertical-align:bottom;
	border:none;
	mso-background-source:auto;
	mso-pattern:auto;
	mso-protection:locked visible;
	white-space:nowrap;
	mso-rotate:0;}
.xl65
	{font-weight:700;
	font-family:Calibri, sans-serif;
	mso-font-charset:0;}
.xl66
	{white-space:normal;}
-->
</style>
</head>

<body link="#0563C1" vlink="#954F72">

<table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:
 collapse;width:96pt'>
<!--StartFragment-->
 <col width=64 span=2 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Grade</td>
  <td class=xl65 width=64 style='width:48pt'>Count</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>O-3</td>
  <td align=right>12</td>
 </tr>
 <tr height=40 style='height:30.0pt'>
  <td height=40 class=xl66 width=64 style='height:30.0pt;width:48pt'>Line one<br>
    Line two</td>
  <td align=right>7</td>
 </tr>
<!--EndFragment-->
</table>

</body>

</html>`,
	'text/plain': 'Grade\tCount\r\nO-3\t12\r\n"Line one\nLine two"\t7\r\n'
};

/** Google Docs: the table inside the `<b style="font-weight:normal">` guid wrapper, every
 *  cell styled inline and holding `<p dir="ltr">` paragraphs, one cell two of them. Bold
 *  is a `font-weight:700` span and a link an `<a>` around an underlined span. */
export const GOOGLE_DOCS: Clipboard = {
	'text/html':
		'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-6f1c2b4e-7fff-3a9d-0c51-8e2d4a7b9f10"><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="301" /><col width="301" /></colgroup><tbody>' +
		'<tr style="height:0pt"><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:12pt;font-family:\'Times New Roman\',serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Task</span></p></td>' +
		'<td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:12pt;font-family:\'Times New Roman\',serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Reference</span></p></td></tr>' +
		'<tr style="height:0pt"><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:12pt;font-family:\'Times New Roman\',serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Submit roster</span></p><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:12pt;font-family:\'Times New Roman\',serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">by Friday</span></p></td>' +
		'<td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><a href="https://www.e-publishing.af.mil/" style="text-decoration:none;"><span style="font-size:12pt;font-family:\'Times New Roman\',serif;color:#1155cc;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">AFI 33-360</span></a></p></td></tr>' +
		'</tbody></table></div></b>'
};

/** Google Sheets: the `<google-sheets-html-origin>` element and its stylesheet ahead of the
 *  table, and the text beside it, whose rows end `\n` and whose cell holding a line break
 *  is quoted. */
export const GOOGLE_SHEETS: Clipboard = {
	'text/html':
		'<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><colgroup><col width="100"/><col width="100"/><col width="140"/></colgroup><tbody>' +
		'<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;">Unit</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;">Strength</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;">Note</td></tr>' +
		'<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">1st Wing</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:42}">42</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;wrap-strategy:4;white-space:normal;word-wrap:break-word;">Line one<br>Line two</td></tr>' +
		'</tbody></table>',
	'text/plain': 'Unit\tStrength\tNote\n1st Wing\t42\t"Line one\nLine two"'
};

/** Chrome, a whole table copied off a web page: a `<thead>`, every element carrying the
 *  computed style Chrome inlines, a `<code>` span and a link. */
export const CHROME: Clipboard = {
	'text/html':
		'<meta charset=\'utf-8\'><table class="wikitable" style="box-sizing: border-box; margin: 1em 0px; background-color: rgb(248, 249, 250); color: rgb(32, 33, 34); border: 1px solid rgb(162, 169, 177); border-collapse: collapse; font-family: sans-serif; font-size: 14px;"><thead style="box-sizing: border-box;"><tr style="box-sizing: border-box;"><th style="box-sizing: border-box; border: 1px solid rgb(162, 169, 177); padding: 0.2em 0.4em; background-color: rgb(234, 236, 240); text-align: center;">Field</th><th style="box-sizing: border-box; border: 1px solid rgb(162, 169, 177); padding: 0.2em 0.4em; background-color: rgb(234, 236, 240); text-align: center;">Meaning</th></tr></thead>' +
		'<tbody style="box-sizing: border-box;"><tr style="box-sizing: border-box;"><td style="box-sizing: border-box; border: 1px solid rgb(162, 169, 177); padding: 0.2em 0.4em;"><code style="box-sizing: border-box; font-family: monospace; background-color: rgb(248, 249, 250);">memo_for</code></td><td style="box-sizing: border-box; border: 1px solid rgb(162, 169, 177); padding: 0.2em 0.4em;">Who the memo is <a href="https://en.wikipedia.org/wiki/Memorandum" style="box-sizing: border-box; color: rgb(51, 102, 204); text-decoration: none;">addressed</a> to</td></tr></tbody></table>'
};

/** Chrome, a selection that starts and ends mid-table: Chrome writes the rows it crossed
 *  and only the cells inside the selection, so the first and last rows are short. */
export const CHROME_PARTIAL: Clipboard = {
	'text/html':
		'<meta charset=\'utf-8\'><table style="border-collapse: collapse; color: rgb(0, 0, 0); font-family: &quot;Times New Roman&quot;; font-size: medium;"><tbody><tr><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">b1</td><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">c1</td></tr><tr><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">a2</td><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">b2</td><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">c2</td></tr><tr><td style="border: 1px solid rgb(0, 0, 0); padding: 4px;">a3</td></tr></tbody></table>'
};
