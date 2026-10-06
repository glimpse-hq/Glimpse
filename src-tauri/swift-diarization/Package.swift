// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GlimpseDiarizationBridge",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "GlimpseDiarizationBridge",
            type: .static,
            targets: ["GlimpseDiarizationBridge"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            exact: "0.12.4"
        )
    ],
    targets: [
        .target(
            name: "GlimpseDiarizationBridge",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ]
        )
    ]
)
