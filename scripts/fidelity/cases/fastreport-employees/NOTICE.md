# Where this case's report comes from

`source.repx` is FastReport's demo report `Demos/Reports/Simple List.frx` (github.com/FastReports/FastReport, commit 8909466f7fe9), written as a DevExpress REPX by `scripts/model/fastreport.ts` on 2026-11-10 (the AI accuracy programme, batch AE). FastReport is MIT-licensed, and its notice is kept here as the licence asks:

```text
Copyright (c) 2024 Fast Reports Inc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

The demo's data (Northwind) is not included: the report names its fields and prints none. Made-up and openly licensed material only belongs in a committed case; a company's report goes in a `local-*` case, which `.gitignore` keeps out.
