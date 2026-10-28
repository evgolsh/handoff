/**
 * Upload commands for the user's own shell. Every value is quoted for the target shell, so a file name or
 * URL can never run as code. The file name is also reduced to a base name by the service before it gets here.
 */

/** POSIX sh: inside single quotes nothing is special; a single quote is written as '\'' . */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * PowerShell: inside single quotes nothing expands; a quote is doubled. PowerShell also treats the
 * typographic single quotes U+2018..U+201B as quote characters, so they are doubled too.
 */
export const psQuote = (s: string): string => `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`;

export interface UploadCommands {
  /** macOS, Linux, WSL, Git Bash: run in the folder that holds the file. */
  curl: string;
  /** Windows PowerShell 5.1 and PowerShell 7: run in the folder that holds the file. */
  powershell: string;
}

export function uploadCommands(fileName: string, url: string, contentType: string): UploadCommands {
  // "./" keeps a name such as "-" or "-x" from being read as stdin or as an option.
  const curl = ["curl", "-sS", "-X", "PUT", "--data-binary", shQuote(`@./${fileName}`), "-H", shQuote(`content-type: ${contentType}`), shQuote(url)].join(" ");
  // -LiteralPath: no wildcard expansion of [ ] * ?. ReadAllBytes sends the exact bytes.
  const powershell =
    `$f = (Resolve-Path -LiteralPath ${psQuote(`.\\${fileName}`)}).ProviderPath; ` +
    `Invoke-RestMethod -Method Put -Uri ${psQuote(url)} -ContentType ${psQuote(contentType)} -Body ([IO.File]::ReadAllBytes($f))`;
  return { curl, powershell };
}
