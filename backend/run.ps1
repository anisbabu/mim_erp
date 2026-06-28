# Launch the backend with JDK 23 (project targets Java 23).
# DB connection comes from persisted User env vars DB_URL/DB_USER/DB_PASS (Neon).
# Neon schema handling lives in application.yml (flyway.schemas + hibernate.default_schema = public).
$jdk23 = 'C:\Program Files\Java\jdk-23'
if (-not (Test-Path "$jdk23\bin\java.exe")) { throw "JDK 23 not found at $jdk23" }
$env:JAVA_HOME = $jdk23
$env:PATH = "$jdk23\bin;$env:PATH"

# Pull persisted Neon creds from User-scope env vars so this works even when the
# current shell predates them (a freshly opened terminal inherits them automatically).
foreach ($n in 'DB_URL','DB_USER','DB_PASS') {
  $v = [Environment]::GetEnvironmentVariable($n,'User')
  if ($v) { Set-Item "env:$n" $v }
}

Set-Location $PSScriptRoot
mvn spring-boot:run
