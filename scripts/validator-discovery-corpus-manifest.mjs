const standard = Object.freeze(["pytest", "ruff", "verify-release"]);

export const validatorDiscoveryCorpusManifest = Object.freeze([
  ["civic311", "b65d21c7d19aa1b3f458e56333481bb75f6ef584", standard, []],
  ["civicboards", "845e777f432ad512953ed49be994c366b87a6070", standard, []],
  ["civicbudget", "731a6b4802cfd8593a00180c37ca3d76a7236de0", standard, []],
  ["civicclerk", "dae807ec9d1370dd22cf6aba88e4c6fc6b4168d5", ["pytest", "verify-release"], []],
  ["civiccode", "05994fe716fa904682ec91b574a35e7cef066aa1", ["build", "pytest", "ruff", "typecheck", "verify-release"], []],
  ["civiccomms", "73be36fdcd3b7d429321fbe8d51cec07a466e16b", standard, []],
  ["civiccontracts", "23bcee99a09e1d58441775f2a03b7dcda870ed21", standard, []],
  ["civiccore", "aca61910a3dd58325d4cfc02da10df90fb6b9efa", standard, []],
  ["civiccourt", "666525cb1e646127a8150894deec1e97fa64912d", standard, []],
  ["civicdata", "5d8378d59bd4e5a7f68d0df48e794c5721d0c8eb", standard, []],
  ["civicelections", "c532f6ceaeba9ed6399e848ce067c50c3789cb74", standard, []],
  ["civicgrants", "5b01d8c6b9c2952591b28f2c5f09039382d4573a", standard, []],
  ["civichr", "7cd481b75f6d97eb3f28c68c78e12940f5879cdd", standard, []],
  ["civicinspect", "02f7912bfb492988d740f303f694d9b782a4a139", standard, []],
  ["civiclegal", "ac511514ed1d52a8e9c1433e757f8a97ddb53f64", standard, []],
  ["civiclibrary", "d7699189707f6dc9b75ad33c5a498d88cb572ab5", standard, []],
  ["civicparks", "7b9b5147c6a265184b713f5bb71f430a81810085", standard, []],
  ["civicpermit", "3d0998ae40930e71094f511471689846abc350f1", standard, []],
  ["civicplan", "252f23cc83638944fadd303955cda11e13bee674", standard, []],
  ["civicprocure", "5836032f396cb901769e9f2ff7a168e30aefb2f6", standard, []],
  ["civicrecords-ai", "538766523ad90ee7553b0ffa75b626d3d4850b17", ["verify-release"], ["compose_test_evidence"]],
  ["civicsafety", "38038f9cab7857b278250ff41946f4d1777715f1", standard, []],
  ["civicutility", "4342098cfc72d5cbd52326fa9fc5db8ec3fde346", standard, []],
  ["civiczone", "1d37826d909a601eea5a10f4ebce0b31a605f5d0", standard, []],
].map(([name, oid, validators, signals]) => Object.freeze([
  name,
  oid,
  Object.freeze([...validators]),
  Object.freeze([...signals]),
])));

const versionByRepository = Object.freeze({
  civic311: "0.1.1",
  civicboards: "0.1.1",
  civicbudget: "0.1.2",
  civicclerk: "1.0.4",
  civiccode: "1.0.8",
  civiccomms: "0.1.1",
  civiccontracts: "0.1.1",
  civiccore: "1.2.1",
  civiccourt: "0.1.2",
  civicdata: "0.1.2",
  civicelections: "0.1.1",
  civicgrants: "0.2.0",
  civichr: "0.1.1",
  civicinspect: "0.2.2",
  civiclegal: "0.1.2",
  civiclibrary: "0.1.1",
  civicparks: "0.1.1",
  civicpermit: "0.2.2",
  civicplan: "0.2.2",
  civicprocure: "0.2.0",
  civicsafety: "0.1.1",
  civicutility: "0.1.1",
  civiczone: "0.2.2",
});

export const versionAuthorityCorpusManifest = Object.freeze(
  validatorDiscoveryCorpusManifest.map(([name, oid]) => Object.freeze([
    name,
    oid,
    name === "civicrecords-ai"
      ? Object.freeze({ state: "declared", source: "backend/pyproject.toml", version: "1.7.3",
        cwd: "backend", reason: "automatic-sole-nested",
        units: Object.freeze([["backend", "declared"], ["docs", "versionless"], ["frontend", "private"]].map(Object.freeze)) })
      : Object.prototype.hasOwnProperty.call(versionByRepository, name)
      ? Object.freeze({ state: "declared", source: "pyproject.toml", version: versionByRepository[name] })
      : Object.freeze({ state: "absent" }),
  ])),
);
