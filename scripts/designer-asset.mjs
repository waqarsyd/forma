/**
 * Is the Forma Designer download on its GitHub release the zip
 * src/lib/designerRelease.ts describes? (2026-11-11, the full audit, SD-21.)
 *
 * scripts/deploy.mjs asked only whether a file of that NAME was on the
 * release, so a zip packed from another commit, or a half-finished upload,
 * passed while the download page showed a SHA-256 the file did not have.
 * `gh release view <tag> --json assets` gives each asset's `digest`
 * ("sha256:<hex>") and `size`, and both are compared here. Its own module so
 * a test can check the comparison without a deploy; pure ASCII, as every
 * script here.
 */

/** The manifest's string and number fields, read from designerRelease.ts's text as deploy.mjs reads them. */
export function manifestOf(source) {
  const text = (name) => (new RegExp(`\\n  ${name}: '([^']*)'`).exec(source) || [])[1];
  const number = (name) => {
    const m = new RegExp(`\\n  ${name}: (\\d+),`).exec(source);
    return m ? Number(m[1]) : undefined;
  };
  return { tag: text('tag'), file: text('file'), sha256: text('sha256'), bytes: number('bytes') };
}

/**
 * Why the release's assets do not carry the manifest's zip, or null when
 * they do: present by name, with GitHub's digest equal to the manifest's
 * SHA-256 and the size equal to its bytes. `assets` is `gh release view
 * --json assets`'s list, or null when the release does not exist.
 */
export function designerAssetProblem(assets, manifest) {
  if (!assets) return `release ${manifest.tag} does not exist`;
  const asset = assets.find((a) => a.name === manifest.file);
  if (!asset) return `release ${manifest.tag} carries no ${manifest.file}`;
  if (asset.digest !== `sha256:${manifest.sha256}`) {
    return `${manifest.file} on release ${manifest.tag} is not the zip the manifest describes (${asset.digest ? `digest ${asset.digest}` : 'no digest'}, expected sha256:${manifest.sha256})`;
  }
  if (manifest.bytes !== undefined && asset.size !== manifest.bytes) {
    return `${manifest.file} on release ${manifest.tag} is ${asset.size} bytes, not the ${manifest.bytes} the manifest describes`;
  }
  return null;
}
