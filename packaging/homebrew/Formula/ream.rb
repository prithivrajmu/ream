class Ream < Formula
  desc "Local-first desktop task time tracker with notes and an overlay"
  homepage "https://github.com/prithivrajmu/ream"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/prithivrajmu/ream/releases/download/v0.1.0/Ream-0.1.0-arm64-mac.zip"
      sha256 "a4a1973865eca0df21e11b56ae389bcba214435fbca2ff6704fcc3fc9d30bc30"
    end

    on_intel do
      url "https://github.com/prithivrajmu/ream/releases/download/v0.1.0/Ream-0.1.0-mac.zip"
      sha256 "2cd866850e4c24e63bfee144f14a63cba33807b4a328e73a54f08991f32c9d34"
    end
  end

  def install
    prefix.install "Ream.app"

    (bin/"ream").write <<~EOS
      #!/bin/bash
      open "#{prefix}/Ream.app" --args "$@"
    EOS
  end

  test do
    assert_predicate prefix/"Ream.app", :directory?
    assert_predicate bin/"ream", :executable?
  end
end
