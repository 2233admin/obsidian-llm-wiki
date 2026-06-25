"""Domain ontology loader — Layer 2 of the 3-tier ontology.

Reads KB/ontology.yaml from the vault and merges with the meta-ontology.
Falls back to a minimal default if the file is absent (first-run friendly).

KB/ontology.yaml shape:
    version: "1"
    domain: my-vault
    entity_types:
      - name: MacroFactor
        parent: Concept
        description: Economic macro factor
    causal_hints:
      - from: MacroFactor
        to: Finding
        relation: causes
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .meta_ontology import CAUSAL_TYPES, DEFAULT_ENTITY_CLASS, ENTITY_CLASSES


@dataclass
class EntityTypeDef:
    name: str
    parent: str = DEFAULT_ENTITY_CLASS
    description: str = ""


@dataclass
class CausalHint:
    from_type: str
    to_type: str
    relation: str


@dataclass
class DomainOntology:
    version: str = "1"
    domain: str = "vault"
    entity_types: list[EntityTypeDef] = field(default_factory=list)
    causal_hints: list[CausalHint] = field(default_factory=list)

    @property
    def entity_type_names(self) -> set[str]:
        return {e.name for e in self.entity_types} | ENTITY_CLASSES

    def is_known_entity(self, name: str) -> bool:
        return name in self.entity_type_names


def load_domain_ontology(vault_path: Path) -> DomainOntology:
    """Load KB/ontology.yaml from vault. Returns default if absent."""
    yaml_path = vault_path / "KB" / "ontology.yaml"
    if not yaml_path.exists():
        return DomainOntology()
    return _parse_ontology_yaml(yaml_path.read_text("utf-8", errors="replace"))


def _parse_ontology_yaml(text: str) -> DomainOntology:
    """Minimal YAML parser — stdlib only, no PyYAML dependency."""
    ont = DomainOntology()
    lines = text.replace("\r\n", "\n").split("\n")
    section: str | None = None
    current_item: dict = {}

    for raw in lines:
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()

        if indent == 0:
            if stripped.startswith("version:"):
                ont.version = _val(stripped)
            elif stripped.startswith("domain:"):
                ont.domain = _val(stripped)
            elif stripped.startswith("entity_types:"):
                section = "entity_types"
                current_item = {}
            elif stripped.startswith("causal_hints:"):
                section = "causal_hints"
                current_item = {}
            continue

        if stripped.startswith("- "):
            if current_item and section:
                _flush(ont, section, current_item)
            current_item = {}
            rest = stripped[2:].strip()
            if ":" in rest:
                k, v = rest.split(":", 1)
                current_item[k.strip()] = v.strip().strip('"').strip("'")
            continue

        if stripped and ":" in stripped and not stripped.startswith("-"):
            k, v = stripped.split(":", 1)
            current_item[k.strip()] = v.strip().strip('"').strip("'")

    if current_item and section:
        _flush(ont, section, current_item)

    return ont


def _flush(ont: DomainOntology, section: str, item: dict) -> None:
    if section == "entity_types" and "name" in item:
        ont.entity_types.append(EntityTypeDef(
            name=item["name"],
            parent=item.get("parent", DEFAULT_ENTITY_CLASS),
            description=item.get("description", ""),
        ))
    elif section == "causal_hints" and "from" in item and "to" in item:
        rel = item.get("relation", "related_to")
        if rel not in CAUSAL_TYPES:
            rel = "related_to"
        ont.causal_hints.append(CausalHint(
            from_type=item["from"],
            to_type=item["to"],
            relation=rel,
        ))


def _val(line: str) -> str:
    colon = line.find(":")
    return line[colon + 1:].strip().strip('"').strip("'") if colon != -1 else ""
