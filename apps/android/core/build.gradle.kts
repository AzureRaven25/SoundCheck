plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}
kotlin { jvmToolchain(17) }
dependencies {
    api(platform(libs.supabase.bom))
    api(libs.supabase.postgrest)
    api(libs.supabase.auth)
    api(libs.supabase.realtime)
    api(libs.supabase.functions)
    api(libs.supabase.storage)
    api(libs.ktor.okhttp)
    api(libs.serialization.json)
    api(libs.coroutines.core)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
// golden fixtures shared with packages/contracts (TypeScript) and SoundCheckKit (Swift)
tasks.test { systemProperty("fixtures", rootProject.file("../../packages/contracts/fixtures").absolutePath) }
