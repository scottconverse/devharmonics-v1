const standard = Object.freeze(["pytest", "ruff", "verify-release"]);
const civicRecordsAi = Object.freeze([
  Object.freeze(["build", "frontend", Object.freeze(["frontend/package.json"])]),
  Object.freeze(["pytest", "backend", Object.freeze(["backend/pyproject.toml"])]),
  Object.freeze(["ruff", "backend", Object.freeze(["backend/pyproject.toml"])]),
  Object.freeze(["test", "frontend", Object.freeze(["frontend/package.json"])]),
  Object.freeze(["verify-release", null, Object.freeze(["scripts/verify-release.sh", ".github/workflows/release.yml"])]),
]);

export const validatorDiscoveryCorpusManifest = Object.freeze([
  ["civic311", "b65d21c7d19aa1b3f458e56333481bb75f6ef584", standard, []],
  ["civicboards", "845e777f432ad512953ed49be994c366b87a6070", standard, []],
  ["civicbudget", "731a6b4802cfd8593a00180c37ca3d76a7236de0", standard, []],
  ["civicclerk", "dae807ec9d1370dd22cf6aba88e4c6fc6b4168d5", ["build", "pytest", "test", "verify-release"], []],
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
  ["civicrecords-ai", "538766523ad90ee7553b0ffa75b626d3d4850b17", civicRecordsAi, ["compose_test_evidence"]],
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

const dependencyFingerprintByRepository = Object.freeze({
  civic311: ["detected", 10, 1, 1, 0, "ed5c01de236b3dc465c6b64220f59b9063251e8defcdc82ef32664a56fab666a"],
  civicboards: ["detected", 10, 1, 1, 0, "e742580ee944f6282fc1697582c8872c01f4744260261bd4c95842eaf1655872"],
  civicbudget: ["detected", 10, 1, 1, 0, "b241472961aa438287b556f4c018341411e209f71eb98f8132947984c10e9cf1"],
  civicclerk: ["detected", 24, 2, 2, 0, "6e5ef500d3ede2edac37f395174df7236076c002ec1d129cfc5d9915133cb28f"],
  civiccode: ["detected", 23, 2, 2, 0, "9530d9cf73e59a555949d7222f70f55aa4b22d88a1a12c1ed0ba48a327a81201"],
  civiccomms: ["detected", 10, 1, 1, 0, "4bb64bba9d56b7f5367ef3f7c7f295c879f681f0bc2eddd81c08846285fd3522"],
  civiccontracts: ["detected", 10, 1, 1, 0, "0d2f7880f121d7127323f345fd8c106307327a8d674918bca8090af832dd7f0c"],
  civiccore: ["detected", 37, 1, 1, 0, "178765cc56d969f04b3e1db4da5aa8faf10dc899a92fb1d8e4e70c2fed506bb2"],
  civiccourt: ["detected", 10, 1, 1, 0, "a34241ca59e839c6d9eed91e2d3efbfa26e37e2baa3e6be7cbd6078b5de03866"],
  civicdata: ["detected", 10, 1, 1, 0, "49a528d5c1997060e19e658d7de41a7b66be8f054ed52ac63a7d4ef5f87c3fe2"],
  civicelections: ["detected", 10, 1, 1, 0, "cc09d2d0a238f99d9decad59d92711e4430975fd99fd8aed144c3a9dad928ecb"],
  civicgrants: ["detected", 10, 1, 1, 0, "019f26e47e684f5b30b1678845e746c68499175f3471662307c9d04a65b3d88e"],
  civichr: ["detected", 10, 1, 1, 0, "e01da01f27566b59900eb137ff08ed0305909de83543e452095749c84e5c8843"],
  civicinspect: ["detected", 10, 1, 1, 0, "58bc3a1cf7d6baca1cb3216997824483d9a3a859400c5ff783d67a2db9b55a3a"],
  civiclegal: ["detected", 10, 1, 1, 0, "6e9235d13c4d5b0b584c569bec176017bdfd13df46e8d32e19e686ecae51aa2c"],
  civiclibrary: ["detected", 9, 1, 1, 0, "41df990df676941b9c4290463234b37032ab21eeb254327b162100f5ea118bbf"],
  civicparks: ["detected", 9, 1, 1, 0, "1e6bdc940a4b1491cae8406b2c00a2d56a8b799c434ac6f43e04d39544b164cd"],
  civicpermit: ["detected", 10, 1, 1, 0, "063894dc608ece963f533d7d6343a88acf8f4fcc7e6959fda36ef856c8fff27b"],
  civicplan: ["detected", 10, 1, 1, 0, "21cd07e62359933043a45fc28ee50281495598f6de13edb0b11048fa31e1a711"],
  civicprocure: ["detected", 10, 1, 1, 0, "1396cb597ce805731a4f5791147bd5f2cfc59b86014acb17bd67e4ce2ba6cf93"],
  "civicrecords-ai": ["detected", 63, 2, 3, 0, "325831b0aaa0e4212f139399b11f9550639ab1eb8f3d4862cf85b12ebea208f1"],
  civicsafety: ["detected", 9, 1, 1, 0, "9749bff60104964f19729a303cf21f45bf84f4df0ea8c2a8c7299c88ced9b982"],
  civicutility: ["detected", 10, 1, 1, 0, "d34ea87beab21d47d33836f5263345fed5fd03b65c73a31c6b3a155b52b6cb10"],
  civiczone: ["detected", 9, 1, 1, 0, "1b57ed289dfe3915c1b1bad63deae5d338c7fc47008c4d66ee5595725a8eeca2"],
});

export const dependencyIntelligenceCorpusManifest = Object.freeze(
  validatorDiscoveryCorpusManifest.map(([name, oid]) => {
    const [state, facts, identities, manifests, diagnostics, sha256] = dependencyFingerprintByRepository[name];
    return Object.freeze([
      name,
      oid,
      Object.freeze({ state, facts, identities, manifests, diagnostics, sha256 }),
    ]);
  }),
);
