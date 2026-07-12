from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .meta_ontology import CAUSAL_TYPES, ENTITY_CLASSES, RELATION_TYPES, TRUST_LEVELS


@dataclass
class EntityTypeDef:
    name: str
    parent: str = "Concept"
    description: str = ""
    properties: list[str] = field(default_factory=list)


@dataclass
class RelationConstraint:
    from_type: str
    to_types: list[str]
    allowed: list[str]


@dataclass
class CausalHint:
    from_type: str
    to_type: str
    relation: str


class DomainOntology:
    def __init__(self, ontology: dict[str, Any] | None = None) -> None:
        self.ontology = ontology if ontology is not None else _empty_ontology()
        self._sync_compat_fields()

    def load(self, vault_path: Path) -> dict[str, Any]:
        path = Path(vault_path) / "KB" / "ontology.yaml"
        if not path.exists():
            self.ontology = self.generate(Path(vault_path), write=False)
        else:
            parsed = _parse_ontology_mapping(path.read_text(encoding="utf-8-sig"))
            self.ontology = parsed
        self._sync_compat_fields()
        return self.ontology

    def generate(self, vault_path: Path, write: bool = True) -> dict[str, Any]:
        ontology = _default_ontology()
        ontology["domain"] = _domain_from_path(Path(vault_path))
        if write:
            kb_dir = Path(vault_path) / "KB"
            kb_dir.mkdir(parents=True, exist_ok=True)
            (kb_dir / "ontology.yaml").write_text(_dump_ontology_yaml(ontology), encoding="utf-8")
        self.ontology = ontology
        self._sync_compat_fields()
        return self.ontology

    def validate(self, ontology: dict[str, Any] | None = None) -> list[str]:
        data = ontology or self.ontology
        errors: list[str] = []

        if not isinstance(data.get("domain"), str) or not data.get("domain"):
            errors.append("domain must be a non-empty string")
        if not isinstance(data.get("version"), str) or not data.get("version"):
            errors.append("version must be a non-empty string")
        if data.get("generated_by") not in {"llm", "human"}:
            errors.append("generated_by must be 'llm' or 'human'")
        if not isinstance(data.get("reviewed"), bool):
            errors.append("reviewed must be boolean")

        entity_types = data.get("entity_types", {})
        if not isinstance(entity_types, dict):
            errors.append("entity_types must be a mapping")
            entity_types = {}

        known_types = set(ENTITY_CLASSES) | set(entity_types)
        for name, spec in entity_types.items():
            if not isinstance(name, str) or not name:
                errors.append("entity type names must be non-empty strings")
                continue
            if not isinstance(spec, dict):
                errors.append(f"entity_types.{name} must be a mapping")
                continue
            parent = spec.get("parent", "Concept")
            if parent not in known_types:
                errors.append(f"entity_types.{name}.parent must reference known type")
            if "properties" in spec and not isinstance(spec["properties"], list):
                errors.append(f"entity_types.{name}.properties must be a list")

        constraints = data.get("relation_constraints", [])
        if not isinstance(constraints, list):
            errors.append("relation_constraints must be a list")
            constraints = []

        for index, constraint in enumerate(constraints):
            prefix = f"relation_constraints[{index}]"
            if not isinstance(constraint, dict):
                errors.append(f"{prefix} must be a mapping")
                continue
            from_type = constraint.get("from")
            if from_type not in known_types:
                errors.append(f"{prefix}.from must reference known type")
            to_types = constraint.get("to")
            if not isinstance(to_types, list) or not to_types:
                errors.append(f"{prefix}.to must be a non-empty list")
                to_types = []
            for to_type in to_types:
                if to_type not in known_types:
                    errors.append(f"{prefix}.to contains unknown type {to_type!r}")
            allowed = constraint.get("allowed")
            if not isinstance(allowed, list) or not allowed:
                errors.append(f"{prefix}.allowed must be a non-empty list")
                allowed = []
            for relation in allowed:
                if relation not in CAUSAL_TYPES:
                    errors.append(f"{prefix}.allowed contains unknown relation {relation!r}")

        trust_values = list(TRUST_LEVELS.values())
        if trust_values != sorted(trust_values, reverse=True):
            errors.append("TRUST_LEVELS must be ordered from highest to lowest trust")

        return errors

    def get_allowed_relations(self, from_type: str, to_type: str) -> list[str]:
        for constraint in self.ontology.get("relation_constraints", []):
            if constraint.get("from") == from_type and to_type in constraint.get("to", []):
                return list(constraint.get("allowed", []))
        return []

    @property
    def entity_type_names(self) -> set[str]:
        return set(ENTITY_CLASSES) | set(self.ontology.get("entity_types", {}))

    def is_known_entity(self, name: str) -> bool:
        return name in self.entity_type_names

    def _sync_compat_fields(self) -> None:
        self.version = str(self.ontology.get("version", "1.0"))
        self.domain = str(self.ontology.get("domain", "vault"))
        self.entity_types = [
            EntityTypeDef(
                name=name,
                parent=str(spec.get("parent", "Concept")),
                description=str(spec.get("description", "")),
                properties=_as_list(spec.get("properties", [])),
            )
            for name, spec in self.ontology.get("entity_types", {}).items()
            if isinstance(spec, dict)
        ]
        hints = list(_constraints_to_hints(self.ontology.get("relation_constraints", [])))
        hints.extend(_legacy_hints_to_objects(self.ontology.get("causal_hints", [])))
        self.causal_hints = hints


def load_domain_ontology(vault_path: Path) -> DomainOntology:
    path = Path(vault_path) / "KB" / "ontology.yaml"
    if not path.exists():
        return DomainOntology()
    ontology = DomainOntology()
    ontology.load(Path(vault_path))
    return ontology


def _parse_ontology_yaml(text: str) -> DomainOntology:
    return DomainOntology(_parse_ontology_mapping(text))


def _parse_ontology_mapping(text: str) -> dict[str, Any]:
    lines = [
        line.rstrip()
        for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if line.strip() and not line.lstrip().startswith("#")
    ]
    data: dict[str, Any] = _empty_ontology()
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith(" ") or ":" not in line:
            index += 1
            continue
        key, value = _split_key_value(line)
        if value:
            data[key] = _parse_scalar(value)
            index += 1
            continue
        if key == "entity_types":
            data[key], index = _parse_entity_types(lines, index + 1)
        elif key == "relation_constraints":
            data[key], index = _parse_relation_constraints(lines, index + 1)
        elif key == "causal_hints":
            data[key], index = _parse_causal_hints(lines, index + 1)
        else:
            data[key] = {}
            index += 1
    return data


def _parse_entity_types(lines: list[str], index: int) -> tuple[dict[str, Any], int]:
    entity_types: dict[str, Any] = {}
    current_name: str | None = None
    while index < len(lines):
        line = lines[index]
        indent = _indent(line)
        stripped = line.strip()
        if indent == 0:
            break
        if indent == 2 and stripped.startswith("- "):
            item = stripped[2:].strip()
            if item.startswith("name:"):
                current_name = str(_parse_scalar(item.split(":", 1)[1].strip()))
                entity_types[current_name] = {}
            index += 1
            continue
        if indent == 2 and stripped.endswith(":"):
            current_name = stripped[:-1].strip()
            entity_types[current_name] = {}
            index += 1
            continue
        if current_name and ":" in stripped:
            key, value = _split_key_value(stripped)
            if value:
                entity_types[current_name][key] = _parse_scalar(value)
                index += 1
            else:
                items, index = _parse_nested_list(lines, index + 1)
                entity_types[current_name][key] = items
            continue
        index += 1
    return entity_types, index


def _parse_relation_constraints(lines: list[str], index: int) -> tuple[list[dict[str, Any]], int]:
    return _parse_list_of_mappings(lines, index)


def _parse_causal_hints(lines: list[str], index: int) -> tuple[list[dict[str, Any]], int]:
    return _parse_list_of_mappings(lines, index)


def _parse_list_of_mappings(lines: list[str], index: int) -> tuple[list[dict[str, Any]], int]:
    items: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    while index < len(lines):
        line = lines[index]
        indent = _indent(line)
        stripped = line.strip()
        if indent == 0:
            break
        if indent == 2 and stripped.startswith("- "):
            if current:
                items.append(current)
            current = {}
            item = stripped[2:].strip()
            if item and ":" in item:
                key, value = _split_key_value(item)
                current[key] = _parse_scalar(value)
            index += 1
            continue
        if current is not None and ":" in stripped:
            key, value = _split_key_value(stripped)
            current[key] = _parse_scalar(value)
        index += 1
    if current:
        items.append(current)
    return items, index


def _parse_nested_list(lines: list[str], index: int) -> tuple[list[str], int]:
    values: list[str] = []
    while index < len(lines):
        line = lines[index]
        indent = _indent(line)
        stripped = line.strip()
        if indent < 6 or not stripped.startswith("- "):
            break
        values.append(str(_parse_scalar(stripped[2:].strip())))
        index += 1
    return values, index


def _constraints_to_hints(constraints: list[dict[str, Any]]) -> list[CausalHint]:
    hints: list[CausalHint] = []
    for constraint in constraints:
        from_type = str(constraint.get("from", ""))
        for to_type in _as_list(constraint.get("to", [])):
            for relation in _as_list(constraint.get("allowed", [])):
                hints.append(CausalHint(from_type=from_type, to_type=str(to_type), relation=str(relation)))
    return hints


def _legacy_hints_to_objects(hints: list[dict[str, Any]]) -> list[CausalHint]:
    result: list[CausalHint] = []
    for hint in hints:
        relation = str(hint.get("relation", "related_to"))
        if relation not in CAUSAL_TYPES:
            relation = "related_to"
        result.append(
            CausalHint(
                from_type=str(hint.get("from", "")),
                to_type=str(hint.get("to", "")),
                relation=relation,
            )
        )
    return result


def _empty_ontology() -> dict[str, Any]:
    return {
        "domain": "personal-knowledge",
        "version": "1.0",
        "generated_by": "llm",
        "reviewed": False,
        "entity_types": {},
        "relation_constraints": [],
    }


def _default_ontology() -> dict[str, Any]:
    ontology = _empty_ontology()
    ontology["entity_types"] = {
        "ResearchFinding": {
            "parent": "Claim",
            "description": "Research finding captured from notes",
            "properties": ["study_type", "confidence_interval"],
        },
        "EngineeringDecision": {
            "parent": "Decision",
            "description": "Engineering decision",
            "properties": ["system", "reversibility"],
        },
    }
    ontology["relation_constraints"] = [
        {
            "from": "ResearchFinding",
            "to": ["Claim", "TradingStrategy"],
            "allowed": ["supports", "contradicts", "refines", "implies"],
        },
        {
            "from": "EngineeringDecision",
            "to": ["EngineeringDecision", "Concept"],
            "allowed": ["requires", "enables", "prevents", "refines"],
        },
    ]
    return ontology


def _domain_from_path(vault_path: Path) -> str:
    name = vault_path.resolve().name.strip().lower()
    return "-".join(part for part in name.replace("_", "-").split("-") if part) or "vault"


def _dump_ontology_yaml(ontology: dict[str, Any]) -> str:
    lines = [
        f"domain: {ontology['domain']}",
        f"version: \"{ontology['version']}\"",
        f"generated_by: {ontology['generated_by']}",
        f"reviewed: {str(ontology['reviewed']).lower()}",
        "entity_types:",
    ]
    for name, spec in ontology.get("entity_types", {}).items():
        lines.extend([
            f"  {name}:",
            f"    parent: {spec.get('parent', 'Concept')}",
            f"    description: \"{spec.get('description', '')}\"",
            "    properties:",
        ])
        for prop in _as_list(spec.get("properties", [])):
            lines.append(f"      - {prop}")
    lines.append("relation_constraints:")
    for constraint in ontology.get("relation_constraints", []):
        lines.extend([
            f"  - from: {constraint.get('from')}",
            f"    to: [{', '.join(_as_list(constraint.get('to', [])))}]",
            f"    allowed: [{', '.join(_as_list(constraint.get('allowed', [])))}]",
        ])
    return "\n".join(lines) + "\n"


def _split_key_value(line: str) -> tuple[str, str]:
    key, value = line.split(":", 1)
    return key.strip(), value.strip()


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _parse_scalar(value: str) -> Any:
    stripped = value.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        inner = stripped[1:-1].strip()
        return [item.strip().strip('"').strip("'") for item in inner.split(",") if item.strip()]
    if stripped in {"true", "True"}:
        return True
    if stripped in {"false", "False"}:
        return False
    if stripped.startswith('"') and stripped.endswith('"'):
        return stripped[1:-1]
    if stripped.startswith("'") and stripped.endswith("'"):
        return stripped[1:-1]
    return stripped


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]
