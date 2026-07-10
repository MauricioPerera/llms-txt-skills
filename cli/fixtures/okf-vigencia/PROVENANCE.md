# Fixture de interop (bytes VERBATIM de ccdd/examples/okf-integration)

La atestacion de policies/refunds.md fue firmada con el tooling Python de
referencia (attest_vigencia.py, ed25519). cli/test.mjs Part 7 verifica que el
CLI Node la acepta tal cual: la prueba de compatibilidad de wire-format entre
ambas toolchains. NO editar: cualquier cambio de bytes anula la firma
(content_sha256 es sobre bytes crudos); .gitattributes pinnea -text.
