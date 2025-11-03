export function greet(name: string): string {
    return `Hello, ${name}!`;
}

if (require.main === module) {
    console.log(greet('SecureZip'));
}
