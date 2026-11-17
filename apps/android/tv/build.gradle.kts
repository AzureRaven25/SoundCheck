import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Client config: only the publishable key ships in the app (secrets.properties is gitignored).
val secrets = Properties().apply { rootProject.file("secrets.properties").takeIf { it.exists() }?.inputStream()?.use(::load) }
fun secret(k: String, default: String = "") = "\"" + (secrets.getProperty(k) ?: default) + "\""

android {
    namespace = "app.soundcheck.tv"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.soundcheck.tv"
        minSdk = 28            // Fire OS 7+ (Android 9), Android phones 9+
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        debug {
            buildConfigField("String", "SUPABASE_URL", secret("sc.supabaseUrl.debug", "http://10.0.2.2:54321"))
            buildConfigField("String", "SITE_URL", secret("sc.siteUrl.debug", "http://10.0.2.2:3000"))
            buildConfigField("String", "SUPABASE_KEY", secret("sc.publishableKey.debug"))
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "SUPABASE_URL", "\"https://ppmzqjrfcbemzzbwicrd.supabase.co\"")
            buildConfigField("String", "SITE_URL", "\"https://soundcheck.app\"")
            buildConfigField("String", "SUPABASE_KEY", secret("sc.publishableKey.release"))
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources { excludes += setOf("META-INF/INDEX.LIST", "META-INF/*.kotlin_module", "META-INF/io.netty.versions.properties") } }
}
kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.icons)
    implementation(libs.activity.compose)
    implementation(libs.coil.compose)
    implementation(libs.coil.ktor)
    implementation(libs.tv.material)
    implementation(libs.media3.exoplayer)
    implementation(libs.zxing)
}
