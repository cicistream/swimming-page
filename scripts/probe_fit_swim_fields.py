#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import struct
from pathlib import Path


DEFAULT_INPUT_DIR = Path.cwd() / "data" / "sources" / "fit-probe"
OUTPUT_DIR = Path.cwd() / "data" / "sources" / "fit-probe"
OUTPUT_FILE = OUTPUT_DIR / "fit-swim-field-report.json"

SWIM_ALIASES = (
    "swolf",
    "avg_swolf",
    "lap_swolf",
    "length_swolf",
    "swim_stroke",
    "stroke",
    "pool_length",
    "pool_length_unit",
    "num_active_lengths",
    "total_strokes",
    "laps",
    "lap",
    "length",
    "trip_times",
)

STANDARD_FIELDS = {
    18: {41: "avg_stroke_count", 42: "avg_stroke_distance", 43: "swim_stroke", 44: "pool_length", 46: "pool_length_unit", 47: "num_active_lengths"},
    19: {41: "avg_stroke_count", 42: "avg_stroke_distance", 43: "swim_stroke", 44: "pool_length", 46: "pool_length_unit", 47: "num_active_lengths"},
    101: {0: "event", 1: "event_type", 2: "start_time", 3: "total_elapsed_time", 4: "total_timer_time", 5: "total_strokes", 6: "avg_speed", 7: "swim_stroke", 8: "avg_swimming_cadence", 9: "event_group", 10: "total_calories", 11: "length_type", 12: "avg_swolf", 13: "total_cycles"},
    206: {0: "developer_data_index", 1: "field_definition_number", 2: "fit_base_type_id", 3: "field_name"},
    207: {0: "developer_data_index", 1: "application_id"},
}

BASE_TYPES = {
    0x00: ("uint8", 1, "B"),
    0x01: ("sint8", 1, "b"),
    0x02: ("uint8", 1, "B"),
    0x83: ("sint16", 2, "h"),
    0x84: ("uint16", 2, "H"),
    0x85: ("sint32", 4, "i"),
    0x86: ("uint32", 4, "I"),
    0x07: ("string", 1, None),
    0x88: ("float32", 4, "f"),
    0x89: ("float64", 8, "d"),
    0x0A: ("uint8z", 1, "B"),
    0x0B: ("uint16z", 2, "H"),
    0x0C: ("uint32z", 4, "I"),
    0x0D: ("byte", 1, None),
    0x8E: ("sint64", 8, "q"),
    0x8F: ("uint64", 8, "Q"),
    0x90: ("uint64z", 8, "Q"),
}


def print_usage() -> None:
    print("Usage:")
    print("  npm run probe:fit:swim-fields -- --dir /absolute/path/to/folder")
    print("")
    print("Options:")
    print("  --dir <path>   Folder containing .fit files")
    print("  --json         Print the final JSON report too")
    print("  --help         Show this message")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dir", default=str(DEFAULT_INPUT_DIR))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--help", "-h", action="store_true")
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        raise SystemExit(f"Unknown arguments: {' '.join(unknown)}")
    if args.help:
        print_usage()
        raise SystemExit(0)
    return args


def read_int(data: bytes, offset: int, fmt: str, little_endian: bool):
    prefix = "<" if little_endian else ">"
    return struct.unpack_from(prefix + fmt, data, offset)[0]


def decode_value(data: bytes, offset: int, base_type: int, size: int, little_endian: bool):
    info = BASE_TYPES.get(base_type)
    chunk = data[offset : offset + size]
    if info is None:
        return chunk.hex(), size

    name, base_size, fmt = info
    if name == "string":
        end = chunk.find(b"\x00")
        if end < 0:
            end = len(chunk)
        return chunk[:end].decode("utf-8", errors="replace"), size

    if name == "byte":
        return chunk.hex(), size

    prefix = "<" if little_endian else ">"
    if size == base_size:
        return struct.unpack_from(prefix + fmt, data, offset)[0], size

    values = []
    cursor = offset
    while cursor + base_size <= offset + size:
        values.append(struct.unpack_from(prefix + fmt, data, cursor)[0])
        cursor += base_size
    return values, size


def normalize_name(name: str | None) -> str:
    return (name or "").strip().lower().replace("-", "_")


def is_relevant_name(name: str) -> bool:
    normalized = normalize_name(name)
    return any(alias in normalized for alias in SWIM_ALIASES)


def find_fit_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.fit") if p.is_file())


def parse_fit_file(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 12 or data[8:12] != b".FIT":
        raise ValueError("Not a FIT file")

    header_size = data[0]
    data_size = struct.unpack_from("<I", data, 4)[0]
    end_offset = min(len(data), header_size + data_size)

    definitions: dict[int, dict] = {}
    developer_field_names: dict[tuple[int, int], str] = {}
    sightings: list[dict] = []
    message_counts: dict[int, int] = {}
    skipped_compressed = 0

    def note(message_number: int, field_number: int, field_name: str, value):
        message_counts[message_number] = message_counts.get(message_number, 0) + 1
        if field_name:
            sightings.append(
                {
                    "messageNumber": message_number,
                    "fieldNumber": field_number,
                    "fieldName": field_name,
                    "value": value,
                }
            )

    offset = header_size
    while offset < end_offset:
        header = data[offset]
        offset += 1

        if header & 0x80:
            local_type = (header >> 5) & 0x03
            definition = definitions.get(local_type)
            if definition is None:
                skipped_compressed += 1
                continue
            for field in definition["fields"]:
                if field["fieldNumber"] == 253:
                    continue
                value, consumed = decode_value(data, offset, field["baseType"], field["size"], definition["littleEndian"])
                offset += consumed
                field_name = STANDARD_FIELDS.get(definition["globalMessageNumber"], {}).get(
                    field["fieldNumber"],
                    f"field_{field['fieldNumber']}",
                )
                note(definition["globalMessageNumber"], field["fieldNumber"], field_name, value)
            for field in definition["developerFields"]:
                value, consumed = decode_value(data, offset, field["baseType"], field["size"], definition["littleEndian"])
                offset += consumed
                field_name = developer_field_names.get(
                    (field["developerDataIndex"], field["fieldNumber"]),
                    f"developer_field_{field['developerDataIndex']}_{field['fieldNumber']}",
                )
                note(definition["globalMessageNumber"], field["fieldNumber"], field_name, value)
            continue

        is_definition = bool(header & 0x40)
        local_type = header & 0x0F

        if is_definition:
            offset += 1  # reserved
            architecture = data[offset]
            offset += 1
            little_endian = architecture == 0
            global_message_number = read_int(data, offset, "H", little_endian)
            offset += 2
            num_fields = data[offset]
            offset += 1

            fields = []
            for _ in range(num_fields):
                field_number = data[offset]
                size = data[offset + 1]
                base_type = data[offset + 2]
                offset += 3
                fields.append({"fieldNumber": field_number, "size": size, "baseType": base_type})

            developer_fields = []
            if header & 0x20:
                num_developer_fields = data[offset]
                offset += 1
                for _ in range(num_developer_fields):
                    field_number = data[offset]
                    size = data[offset + 1]
                    developer_data_index = data[offset + 2]
                    offset += 3
                    developer_fields.append(
                        {
                            "fieldNumber": field_number,
                            "size": size,
                            "developerDataIndex": developer_data_index,
                            "baseType": 0x88,
                        }
                    )

            definitions[local_type] = {
                "globalMessageNumber": global_message_number,
                "littleEndian": little_endian,
                "fields": fields,
                "developerFields": developer_fields,
            }
            continue

        definition = definitions.get(local_type)
        if definition is None:
            raise ValueError(f"Missing definition for local message type {local_type}")

        values_by_field = {}
        for field in definition["fields"]:
            value, consumed = decode_value(data, offset, field["baseType"], field["size"], definition["littleEndian"])
            offset += consumed
            field_name = STANDARD_FIELDS.get(definition["globalMessageNumber"], {}).get(
                field["fieldNumber"],
                f"field_{field['fieldNumber']}",
            )
            values_by_field[field["fieldNumber"]] = value
            note(definition["globalMessageNumber"], field["fieldNumber"], field_name, value)

        if definition["globalMessageNumber"] == 206:
            dev_index = values_by_field.get(0)
            field_num = values_by_field.get(1)
            field_name = values_by_field.get(3)
            if dev_index is not None and field_num is not None and field_name:
                developer_field_names[(int(dev_index), int(field_num))] = str(field_name)

        for field in definition["developerFields"]:
            value, consumed = decode_value(data, offset, field["baseType"], field["size"], definition["littleEndian"])
            offset += consumed
            field_name = developer_field_names.get(
                (field["developerDataIndex"], field["fieldNumber"]),
                f"developer_field_{field['developerDataIndex']}_{field['fieldNumber']}",
            )
            note(definition["globalMessageNumber"], field["fieldNumber"], field_name, value)

    swim_names = sorted({item["fieldName"] for item in sightings if is_relevant_name(item["fieldName"])})
    matched = {
        "swolf": [name for name in swim_names if "swolf" in normalize_name(name)],
        "stroke": [name for name in swim_names if "stroke" in normalize_name(name)],
        "poolLength": [name for name in swim_names if "pool_length" in normalize_name(name)],
        "laps": [
            name
            for name in swim_names
            if "lap" in normalize_name(name)
            or "length" in normalize_name(name)
            or "num_active_lengths" in normalize_name(name)
        ],
    }

    return {
        "file": str(path),
        "messageCounts": dict(sorted(message_counts.items())),
        "skippedCompressedTimestampMessages": skipped_compressed,
        "sampleFields": swim_names[:20],
        "swimHits": [item for item in sightings if is_relevant_name(item["fieldName"])],
        "matchedFieldNames": matched,
        "detected": {key: bool(value) for key, value in matched.items()},
    }


def main() -> None:
    args = parse_args(os.sys.argv[1:])
    input_dir = Path(args.dir)
    files = find_fit_files(input_dir)

    if not files:
        print(f"No .fit files found under {input_dir}")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    report = []
    totals = {"files": 0, "swolf": 0, "stroke": 0, "poolLength": 0, "laps": 0}

    for file_path in files:
        try:
            relative = file_path.relative_to(input_dir)
        except ValueError:
            relative = file_path.name

        try:
            parsed = parse_fit_file(file_path)
            report.append(parsed)
            totals["files"] += 1
            for key in ("swolf", "stroke", "poolLength", "laps"):
                if parsed["detected"][key]:
                    totals[key] += 1

            print(f"\n== {relative} ==")
            print(
                json.dumps(
                    {
                        "file": str(relative),
                        "detected": parsed["detected"],
                        "sampleFields": parsed["sampleFields"],
                        "messageCounts": parsed["messageCounts"],
                        "skippedCompressedTimestampMessages": parsed["skippedCompressedTimestampMessages"],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        except Exception as exc:  # pragma: no cover
            report.append({"file": str(file_path), "error": str(exc)})
            totals["files"] += 1
            print(f"\n== {relative} ==")
            print(json.dumps({"file": str(relative), "error": str(exc)}, ensure_ascii=False, indent=2))

    summary = {"inputDir": str(input_dir), "totals": totals, "report": report}
    OUTPUT_FILE.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    print("\n== Aggregate summary ==")
    print(json.dumps({"inputDir": str(input_dir), "totals": totals, "outputFile": str(OUTPUT_FILE)}, ensure_ascii=False, indent=2))

    if args.json:
        print("\n== Full JSON report ==")
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
