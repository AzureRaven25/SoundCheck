// SoundCheck for Android: :core (shared logic, plain Kotlin/JVM), :tv (Fire TV / Android TV), :mobile (phone mic).
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "SoundCheck"
include(":core", ":tv", ":mobile")
