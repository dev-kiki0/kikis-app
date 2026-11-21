#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

packages=(
  "packages/sdk"
  "packages/nulth-sdk"
  "packages/mcp-server"
)

allowed_exact=("package.json" "README.md" "LICENSE")

for pkg_dir in "${packages[@]}"; do
  full_path="$root/$pkg_dir"
  echo "Checking packed files for $pkg_dir..."
  
  # Verify required build artifacts exist
  pkg_json="$full_path/package.json"
  if [[ ! -f "$pkg_json" ]]; then
    echo "ERROR: $pkg_dir package.json not found" >&2
    exit 1
  fi
  
  # Extract main, module, types fields and verify they exist
  main=$(node -e "console.log(require('$pkg_json').main || '')")
  module=$(node -e "console.log(require('$pkg_json').module || '')")
  types=$(node -e "console.log(require('$pkg_json').types || '')")
  
  for artifact in "$main" "$module" "$types"; do
    if [[ -z "$artifact" ]]; then
      continue
    fi
    
    artifact_path="$full_path/$artifact"
    if [[ ! -f "$artifact_path" ]]; then
      echo "ERROR: Required artifact missing in $pkg_dir: $artifact" >&2
      exit 1
    fi
  done
  
  # Run npm pack --dry-run --json and parse files without jq
  file_list=$(npm pack --dry-run --json "$full_path" | node -p "JSON.parse(require('fs').readFileSync(0))[0].files.map(f=>f.path).join('\n')")
  
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    
    # Check if file is in dist/
    if [[ "$file" == dist/* ]]; then
      continue
    fi
    
    # Check if file is in allowed exact list
    is_allowed=0
    for allowed in "${allowed_exact[@]}"; do
      if [[ "$file" == "$allowed" ]]; then
        is_allowed=1
        break
      fi
    done
    
    if [[ $is_allowed -eq 0 ]]; then
      echo "ERROR: Disallowed file in $pkg_dir package: $file" >&2
      exit 1
    fi
  done <<< "$file_list"
  
  echo "  $pkg_dir pack hygiene: OK"
done

echo "All packages passed package hygiene checks."
